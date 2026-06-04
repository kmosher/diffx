import { useState, useEffect, useCallback } from 'react'

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

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

export function useDiff(options: DiffOptions) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    void load()
  }, [load])

  // SSE: re-fetch diff when a file is written from the browser editor.
  // Filed-written events can also come from other sources later (e.g., agent
  // writes); piggybacking on the existing event stream avoids a second channel.
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.type === 'file-written') void load()
      } catch {}
    })
    return () => es.close()
  }, [load])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    customMode: data?.customMode ?? false,
    binaryFiles: data?.binaryFiles ?? [],
    untrackedFiles: data?.untrackedFiles ?? [],
    fileContents: data?.fileContents ?? {},
    loading,
    error,
    reload: load,
  }
}
