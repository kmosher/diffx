import type { ReviewComment } from './types.js'

export interface CommentStore {
  getAll(): Promise<ReviewComment[]>
  add(comment: ReviewComment): Promise<ReviewComment>
  update(id: string, body: string): Promise<ReviewComment | null>
  remove(id: string): Promise<boolean>
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

  async update(id: string, body: string): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) return null
    comment.body = body
    return comment
  }

  async remove(id: string): Promise<boolean> {
    const index = this.comments.findIndex((c) => c.id === id)
    if (index === -1) return false
    this.comments.splice(index, 1)
    return true
  }
}
