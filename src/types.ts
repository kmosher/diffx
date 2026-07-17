export interface CommentReply {
  id: string
  body: string
  createdAt: number
  // 'user' = added from the browser UI by the human reviewer.
  // 'agent' = added by the bot via the comments API during /diffx-finish-review.
  // Optional for backward compatibility with replies persisted before the field existed;
  // consumers should treat a missing author as 'agent' (the original sole writer).
  author?: 'user' | 'agent'
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  // For multi-line ranges, lineNumber is the (inclusive) start and endLine the (inclusive) end.
  // For a single-line comment, endLine === lineNumber. Optional so external CommentStore
  // implementations migrating from a pre-multiline schema can return rows without it;
  // every in-tree consumer treats a missing endLine as equal to lineNumber.
  lineNumber: number
  endLine?: number
  // Single line: the one line's text. Range: lines joined with '\n' (one entry per row in
  // [lineNumber, endLine]). Consumers that split on newline or take .length need to branch
  // on whether endLine > lineNumber.
  lineContent: string
  body: string
  // 'draft' = saved but not yet visible to the agent — suppressed from every
  // watcher/ws broadcast (comment-added, comment-updated) until "Post
  // drafts" or "Done reviewing" flips it to 'open' in one batch. Server-side
  // so a draft survives a tab reload, unlike a client-only queue.
  status: 'open' | 'resolved' | 'draft'
  createdAt: number
  replies: CommentReply[]
  // GitHub-style staleness flag, independent of status: a live file edit
  // moved or removed the text this comment was anchored to and re-anchoring
  // (see reanchor.ts) couldn't find a confident new position. The comment
  // stays at its last-known lineNumber/endLine — still useful context, just
  // not guaranteed to point at the right lines anymore. Absent/false means
  // current.
  outdated?: boolean
  // Optional inline-suggestion payload. When present, the comment is a
  // proposed rewrite: lineContent holds the original lines being replaced
  // (one per row in [lineNumber, endLine]); suggestion.newLines is the
  // replacement. Rendered to the agent as a ```suggestion fenced block.
  suggestion?: {
    newLines: string[]
  }
}
