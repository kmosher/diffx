import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { ReviewComment } from './types.js'

// Comments persist next to the session state file (same directory, same
// cwd-hash/session identity) rather than in the repo itself — they're
// reviewer scratch state tied to a diffx session, not something that
// belongs in git history.
export function commentsFilePathFor(statePath: string): string {
  return statePath.replace(/\.json$/, '') + '.comments.json'
}

export function loadPersistedComments(path: string): ReviewComment[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupt or partially-written file (e.g. killed mid-write) — start
    // fresh rather than crashing the server on launch.
    return []
  }
}

export function savePersistedComments(path: string, comments: ReviewComment[]): void {
  try {
    writeFileSync(path, JSON.stringify(comments, null, 2))
  } catch {
    // Best-effort: a failed write (disk full, permissions) shouldn't crash
    // an otherwise-working review session. Comments stay correct in memory
    // for the rest of this process; only durability across a restart is lost.
  }
}
