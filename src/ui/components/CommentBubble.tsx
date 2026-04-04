import type { ReviewComment } from '../../types'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
}

export function CommentBubble({ comment, onDelete }: CommentBubbleProps) {
  return (
    <div className="comment-bubble">
      <div className="comment-bubble-body">{comment.body}</div>
      <button
        className="comment-bubble-delete"
        onClick={() => onDelete(comment.id)}
        title="Delete comment"
      >
        &times;
      </button>
    </div>
  )
}
