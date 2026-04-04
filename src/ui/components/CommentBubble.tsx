import { useState, useEffect } from 'react'
import { UserCircle } from 'lucide-react'
import type { ReviewComment } from '../../types'

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
}

export function CommentBubble({ comment, onDelete }: CommentBubbleProps) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="comment-bubble">
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
        <button
          className="comment-bubble-delete"
          onClick={() => onDelete(comment.id)}
          title="Delete comment"
        >
          &times;
        </button>
      </div>
      <div className="comment-bubble-body">{comment.body}</div>
    </div>
  )
}
