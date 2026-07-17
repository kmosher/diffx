import type { ReviewComment, CommentReply } from './types.js'

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
  private comments: ReviewComment[] = []

  async getAll(): Promise<ReviewComment[]> {
    return this.comments
  }

  async add(comment: ReviewComment): Promise<ReviewComment> {
    this.comments.push(comment)
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
    return comment
  }

  async remove(id: string): Promise<boolean> {
    const index = this.comments.findIndex((c) => c.id === id)
    if (index === -1) return false
    this.comments.splice(index, 1)
    return true
  }

  async addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === commentId)
    if (!comment) return null
    comment.replies.push(reply)
    return comment
  }
}
