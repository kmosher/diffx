import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isSafePath } from './path.js'
import { writeWorkingTreeFile } from './git.js'

// 1-based line numbers (matching ReviewComment.lineNumber/endLine), 0-based
// columns, endColumn exclusive — same convention as the schema v3 comment
// fields (see types.ts).
export interface DeleteRange {
  filePath: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface SpliceResult {
  deletedText: string
}

// Removes the exact character range from the working-tree file and writes
// it back via writeWorkingTreeFile (same path the in-browser file editor
// uses). Returns the text that was deleted (for the undo buffer / user-edit
// event), or null if the path is unsafe, the file can't be read, or the
// range doesn't fit the file's current line count — the last case matters
// because the range was computed against whatever the browser last
// rendered, which may have drifted from disk by the time this request
// lands.
export function spliceDeleteRange(repoRoot: string, range: DeleteRange): SpliceResult | null {
  if (!isSafePath(range.filePath, repoRoot)) return null
  let content: string
  try {
    content = readFileSync(resolve(repoRoot, range.filePath), 'utf-8')
  } catch {
    return null
  }
  const lines = content.split('\n')

  const startIdx = range.startLine - 1
  const endIdx = range.endLine - 1
  if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) return null
  const firstLine = lines[startIdx]
  const lastLine = lines[endIdx]
  if (range.startColumn < 0 || range.startColumn > firstLine.length) return null
  if (range.endColumn < 0 || range.endColumn > lastLine.length) return null
  if (startIdx === endIdx && range.startColumn > range.endColumn) return null

  let deletedText: string
  let mergedLine: string
  if (startIdx === endIdx) {
    deletedText = firstLine.slice(range.startColumn, range.endColumn)
    mergedLine = firstLine.slice(0, range.startColumn) + firstLine.slice(range.endColumn)
  } else {
    deletedText = [
      firstLine.slice(range.startColumn),
      ...lines.slice(startIdx + 1, endIdx),
      lastLine.slice(0, range.endColumn),
    ].join('\n')
    mergedLine = firstLine.slice(0, range.startColumn) + lastLine.slice(range.endColumn)
  }

  lines.splice(startIdx, endIdx - startIdx + 1, mergedLine)
  const newContent = lines.join('\n')
  if (!writeWorkingTreeFile(range.filePath, newContent)) return null
  return { deletedText }
}

// Inverse of spliceDeleteRange: re-inserts `deletedText` at (startLine,
// startColumn) — the position it was removed from. Only correct if nothing
// else has touched the file at that position since the delete; the caller
// (server.ts) accepts that as the tradeoff for keeping the undo buffer
// simple (no operational-transform reconciliation against interleaved
// edits — out of scope, see Stage 6's Decisions entry).
export function spliceInsertText(repoRoot: string, filePath: string, startLine: number, startColumn: number, text: string): boolean {
  if (!isSafePath(filePath, repoRoot)) return false
  let content: string
  try {
    content = readFileSync(resolve(repoRoot, filePath), 'utf-8')
  } catch {
    return false
  }
  const lines = content.split('\n')
  const idx = startLine - 1
  if (idx < 0 || idx >= lines.length) return false
  const line = lines[idx]
  if (startColumn < 0 || startColumn > line.length) return false

  const insertedLines = text.split('\n')
  if (insertedLines.length === 1) {
    lines[idx] = line.slice(0, startColumn) + text + line.slice(startColumn)
  } else {
    const before = line.slice(0, startColumn)
    const after = line.slice(startColumn)
    const newLines = insertedLines.slice()
    newLines[0] = before + newLines[0]
    newLines[newLines.length - 1] = newLines[newLines.length - 1] + after
    lines.splice(idx, 1, ...newLines)
  }
  return writeWorkingTreeFile(filePath, lines.join('\n'))
}
