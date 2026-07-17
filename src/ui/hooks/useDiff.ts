import { useState, useEffect, useCallback, useRef } from 'react'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

// Per-side file contents bundled into /api/diff. Used to construct
// non-partial FileDiffMetadata so CodeView can render expand-context UI.
// Files that exceed the server's per-file cap come back as `oversize`;
// missing-at-ref (added/deleted file) comes back as `missing`. CodeView
// falls back to patch-only rendering in either case.
export type SideContents =
  | { contents: string }
  | { binary: true }
  | { oversize: true; size: number }
  | { missing: true }

export type FileContentsMap = Record<string, { old: SideContents; new: SideContents }>

interface DiffData {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  binaryFiles: BinaryFileInfo[]
  untrackedFiles: string[]
  fileContents: FileContentsMap
}

// Scoped shape returned by GET /api/diff?file=<path> — same fields, but
// binaryFiles/untrackedFiles/fileContents only ever mention that one path,
// and `patch` is just that file's fragment ('' if it has no pending diff).
type FileDiffData = DiffData

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

// Replace (or remove, or append) one file's fragment within a full unified
// patch. Mirrors the server's extractFilePatch boundary logic so a
// per-file refetch can be spliced back into the client's merged patch
// without re-fetching every other file.
function spliceFilePatch(fullPatch: string, filePath: string, fragment: string): string {
  const lines = fullPatch ? fullPatch.split('\n') : []
  const targetPrefix = 'diff --git a/'
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(targetPrefix)) continue
    const match = lines[i].match(/^diff --git a\/.+ b\/(.+)$/)
    if (start === -1) {
      if (match?.[1] === filePath) start = i
      continue
    }
    end = i
    break
  }
  const fragLines = fragment ? fragment.split('\n') : []
  if (start === -1) {
    // Not previously in the patch. Nothing to remove; append if there's
    // something to add.
    return fragment ? [...lines, ...fragLines].join('\n') : fullPatch
  }
  return [...lines.slice(0, start), ...fragLines, ...lines.slice(end)].join('\n')
}

export function useDiff(options: DiffOptions) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Mirrors `data` for the merge path below, which runs inside an event
  // handler closure that would otherwise see a stale `data` from the render
  // that registered the EventSource listener.
  const dataRef = useRef<DiffData | null>(null)
  dataRef.current = data

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetch(`/api/diff?staged=${options.staged}&untracked=${options.untracked}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [options.staged, options.untracked])

  // Targeted refetch: pull just one file's diff and splice it into the
  // current merged state, instead of re-fetching and re-parsing everything.
  // Falls back to a full load() if we don't have a base diff to merge into
  // yet (e.g. the file-written event races the initial load).
  const loadFile = useCallback(
    (path: string) => {
      const base = dataRef.current
      if (!base) return load()
      return fetch(`/api/diff?staged=${options.staged}&untracked=${options.untracked}&file=${encodeURIComponent(path)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        .then((json: FileDiffData) => {
          setData((prev) => {
            const cur = prev ?? base
            const patch = spliceFilePatch(cur.patch, path, json.patch)
            const binaryFiles = [...cur.binaryFiles.filter((b) => b.path !== path), ...json.binaryFiles]
            const untrackedFiles = json.untrackedFiles.length
              ? [...new Set([...cur.untrackedFiles, ...json.untrackedFiles])]
              : cur.untrackedFiles.filter((f) => f !== path)
            const fileContents = { ...cur.fileContents }
            if (path in json.fileContents) {
              fileContents[path] = json.fileContents[path]
            } else {
              delete fileContents[path]
            }
            return { ...cur, patch, binaryFiles, untrackedFiles, fileContents }
          })
        })
        .catch((err) => setError(err.message))
    },
    [options.staged, options.untracked, load],
  )

  useEffect(() => {
    void load()
  }, [load])

  // SSE: re-fetch diff when a file changes. `path: null` (the `diffx
  // refresh` / batch fallback) triggers a full reload; a concrete path goes
  // through the scoped per-file refetch above.
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed.type !== 'file-written' && parsed.type !== 'file-changed') return
        if (parsed.path) void loadFile(parsed.path)
        else void load()
      } catch {}
    })
    return () => es.close()
  }, [load, loadFile])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    customMode: data?.customMode ?? false,
    binaryFiles: data?.binaryFiles ?? [],
    untrackedFiles: data?.untrackedFiles ?? [],
    fileContents: data?.fileContents ?? {},
    loading,
    // True only before the first successful load. A background refetch
    // (SSE file-written, `diffx refresh`) still flips `loading`, but the
    // caller already has `data` to render from — distinguishing the two
    // lets the UI keep the diff mounted (and its scroll position intact)
    // instead of unmounting to a full-page spinner on every refresh.
    initialLoading: loading && data === null,
    error,
    reload: load,
  }
}
