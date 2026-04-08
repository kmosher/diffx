import { useState, useMemo } from 'react'
import { MessageSquare, CheckCircle2, Circle, FileText } from 'lucide-react'
import type { ReviewComment } from '../../types'

type StatusFilter = 'all' | 'open' | 'resolved'

interface CommentListProps {
  comments: ReviewComment[]
  onNavigate: (filePath: string, commentId: string) => void
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '...'
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

export function CommentList({ comments, onNavigate }: CommentListProps) {
  const [filter, setFilter] = useState<StatusFilter>('all')

  const openCount = useMemo(() => comments.filter((c) => c.status === 'open').length, [comments])
  const resolvedCount = useMemo(() => comments.filter((c) => c.status === 'resolved').length, [comments])

  const grouped = useMemo(() => {
    const filtered = filter === 'all' ? comments : comments.filter((c) => c.status === filter)

    const map = new Map<string, ReviewComment[]>()
    for (const c of filtered) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push(c)
    }
    return map
  }, [comments, filter])

  if (comments.length === 0) {
    return (
      <div className="cl-empty">
        <MessageSquare size={20} />
        <span>No comments yet</span>
      </div>
    )
  }

  return (
    <div className="cl">
      <div className="cl-filters">
        <button
          className={`cl-filter-btn ${filter === 'all' ? 'cl-filter-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({comments.length})
        </button>
        <button
          className={`cl-filter-btn ${filter === 'open' ? 'cl-filter-active' : ''}`}
          onClick={() => setFilter('open')}
        >
          <Circle size={10} />
          Open ({openCount})
        </button>
        <button
          className={`cl-filter-btn ${filter === 'resolved' ? 'cl-filter-active' : ''}`}
          onClick={() => setFilter('resolved')}
        >
          <CheckCircle2 size={10} />
          Resolved ({resolvedCount})
        </button>
      </div>
      <div className="cl-list">
        {[...grouped.entries()].map(([filePath, fileComments]) => (
          <div key={filePath} className="cl-file-group">
            <div className="cl-file-header">
              <FileText size={13} />
              <span className="cl-file-name" title={filePath}>{fileName(filePath)}</span>
              <span className="cl-file-count">{fileComments.length}</span>
            </div>
            {fileComments.map((comment) => (
              <div
                key={comment.id}
                className={`cl-item ${comment.status === 'resolved' ? 'cl-item-resolved' : ''}`}
                onClick={() => onNavigate(comment.filePath, comment.id)}
              >
                <div className="cl-item-status">
                  {comment.status === 'open' ? (
                    <Circle size={12} className="cl-status-open" />
                  ) : (
                    <CheckCircle2 size={12} className="cl-status-resolved" />
                  )}
                </div>
                <div className="cl-item-content">
                  <div className="cl-item-body">{truncate(comment.body, 80)}</div>
                  <div className="cl-item-meta">
                    L{comment.lineNumber}
                    {comment.replies.length > 0 && (
                      <span className="cl-item-replies">
                        · {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
