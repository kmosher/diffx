import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReviewComment } from './types.js'
import type { CommentStore } from './comments.js'
import { isSafePath } from './path.js'

// Lines to search on either side of a comment's last-known position before
// falling back to a whole-file scan. Keeps the common case (a nearby edit
// shifted a few lines) cheap and unambiguous — a match found close to where
// the reviewer left the comment is far more likely to be the right one than
// an identical-looking line somewhere else in the file.
const SEARCH_WINDOW = 25

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

// Finds the 1-based start line of a contiguous block of `blockLines` inside
// `fileLines`. Searches the window around `hint` first, then the rest of the
// file. `normalize` toggles exact vs. fuzzy (trimmed/whitespace-collapsed)
// comparison — callers try exact first, then fall back to fuzzy.
function findBlock(fileLines: string[], blockLines: string[], hint: number, normalize: boolean): number | null {
  if (blockLines.length === 0 || blockLines.length > fileLines.length) return null
  const linesEqual = normalize
    ? (a: string, b: string) => normalizeLine(a) === normalizeLine(b)
    : (a: string, b: string) => a === b
  const matchesAt = (start: number): boolean => {
    for (let i = 0; i < blockLines.length; i++) {
      if (!linesEqual(fileLines[start + i], blockLines[i])) return false
    }
    return true
  }

  const maxStart = fileLines.length - blockLines.length
  const hintIdx = Math.min(Math.max(hint - 1, 0), maxStart)
  const lo = Math.max(0, hintIdx - SEARCH_WINDOW)
  const hi = Math.min(maxStart, hintIdx + SEARCH_WINDOW)
  for (let start = lo; start <= hi; start++) {
    if (matchesAt(start)) return start + 1
  }
  for (let start = 0; start <= maxStart; start++) {
    if (start >= lo && start <= hi) continue // already checked above
    if (matchesAt(start)) return start + 1
  }
  return null
}

/**
 * Remaps every open, additions-side comment on `filePath` to its new
 * position after a working-tree change — GitHub semantics: exact match near
 * the old position first, then a normalized fuzzy match, else the comment is
 * flagged `outdated` and left at its last-known lineNumber/endLine.
 *
 * Deletion-side comments are left untouched: they're anchored to the diff's
 * "old" side (content that no longer exists in the working tree by
 * definition), so there's nothing live to re-anchor them against.
 *
 * Returns only the comments that actually changed (position or outdated
 * flag), so the caller can broadcast just those.
 */
export async function reanchorFileComments(
  filePath: string,
  store: CommentStore,
  repoRoot: string,
): Promise<ReviewComment[]> {
  if (!isSafePath(filePath, repoRoot)) return []

  let content: string | null = null
  try {
    content = readFileSync(resolve(repoRoot, filePath), 'utf-8')
  } catch {
    // Deleted, unreadable, or binary-as-utf8 garbage — treat as "no lines
    // to match against" so every comment on it falls through to outdated.
    content = null
  }
  const fileLines = content !== null && content.length > 0 ? content.split('\n') : []

  const all = await store.getAll()
  const targets = all.filter((c) => c.filePath === filePath && c.status === 'open' && c.side === 'additions')
  const changed: ReviewComment[] = []

  for (const comment of targets) {
    const blockLines = comment.lineContent.split('\n')
    const start = findBlock(fileLines, blockLines, comment.lineNumber, false) ?? findBlock(fileLines, blockLines, comment.lineNumber, true)

    if (start === null) {
      if (comment.outdated) continue
      const updated = await store.update(comment.id, { outdated: true })
      if (updated) changed.push(updated)
      continue
    }

    const endLine = comment.endLine ?? comment.lineNumber
    const newEndLine = start + (endLine - comment.lineNumber)
    if (start === comment.lineNumber && newEndLine === endLine && !comment.outdated) continue
    const updated = await store.update(comment.id, {
      lineNumber: start,
      endLine: newEndLine,
      outdated: false,
    })
    if (updated) changed.push(updated)
  }

  return changed
}
