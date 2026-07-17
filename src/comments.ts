import type { ReviewComment, CommentReply } from './types.js'
import { loadPersistedComments, savePersistedComments } from './persistence.js'

// Fields callers may patch via update(). Broader than "user edits" (body,
// status) to also cover the re-anchoring fields reanchor.ts writes after a
// live file change (lineNumber/endLine/lineContent/outdated).
export type CommentUpdateFields = Partial<
  Pick<ReviewComment, 'body' | 'status' | 'lineNumber' | 'endLine' | 'lineContent' | 'outdated'>
>

export interface CommentStore {
  getAll(): Promise<ReviewComment[]>
  add(comment: ReviewComment): Promise<ReviewComment>
  update(id: string, fields: CommentUpdateFields): Promise<ReviewComment | null>
  remove(id: string): Promise<boolean>
  addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null>
}

export class InMemoryCommentStore implements CommentStore {
  protected comments: ReviewComment[] = []

  // No-op hook, overridden by FileBackedCommentStore. Called after every
  // mutating operation so a subclass can persist without duplicating the
  // mutation logic above.
  protected persist(): void {}

  async getAll(): Promise<ReviewComment[]> {
    return this.comments
  }

  async add(comment: ReviewComment): Promise<ReviewComment> {
    this.comments.push(comment)
    this.persist()
    return comment
  }

  async update(id: string, fields: CommentUpdateFields): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) return null
    if (fields.body !== undefined) comment.body = fields.body
    if (fields.status !== undefined) comment.status = fields.status
    if (fields.lineNumber !== undefined) comment.lineNumber = fields.lineNumber
    if (fields.endLine !== undefined) comment.endLine = fields.endLine
    if (fields.lineContent !== undefined) comment.lineContent = fields.lineContent
    if (fields.outdated !== undefined) comment.outdated = fields.outdated
    this.persist()
    return comment
  }

  async remove(id: string): Promise<boolean> {
    const index = this.comments.findIndex((c) => c.id === id)
    if (index === -1) return false
    this.comments.splice(index, 1)
    this.persist()
    return true
  }

  async addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === commentId)
    if (!comment) return null
    comment.replies.push(reply)
    this.persist()
    return comment
  }
}

// Same behavior as InMemoryCommentStore, plus: loads from `filePath` at
// construction and writes the full comment list back after every mutation.
// Comments (including drafts — see reanchor.ts/server.ts's draft-suppression
// logic, which is orthogonal to persistence) survive a server restart or
// `diffx` version upgrade instead of the review silently starting over.
export class FileBackedCommentStore extends InMemoryCommentStore {
  private readonly filePath: string

  constructor(filePath: string) {
    super()
    this.filePath = filePath
    this.comments = loadPersistedComments(filePath)
  }

  protected persist(): void {
    savePersistedComments(this.filePath, this.comments)
  }
}
