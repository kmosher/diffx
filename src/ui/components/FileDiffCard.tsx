import { useState } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'

interface PendingComment {
  side: AnnotationSide
  lineNumber: number
}

interface FileDiffCardProps {
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  diffStyle: 'split' | 'unified'
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, body: string) => void
  onDeleteComment: (id: string) => void
}

export function FileDiffCard({
  fileDiff,
  filePath,
  annotations,
  diffStyle,
  onAddComment,
  onDeleteComment,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...annotations,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <div className="file-diff-card">
      <FileDiff<ReviewComment | { _pending: true }>
        fileDiff={fileDiff}
        options={{
          diffStyle,
          enableGutterUtility: true,
          onGutterUtilityClick: (range) => {
            setPending({
              side: range.side ?? 'additions',
              lineNumber: range.start,
            })
          },
        }}
        lineAnnotations={allAnnotations}
        renderAnnotation={(annotation) => {
          if ('_pending' in annotation.metadata) {
            return (
              <CommentForm
                onSubmit={(body) => {
                  onAddComment(filePath, pending!.side, pending!.lineNumber, body)
                  setPending(null)
                }}
                onCancel={() => setPending(null)}
              />
            )
          }
          return (
            <CommentBubble
              comment={annotation.metadata as ReviewComment}
              onDelete={onDeleteComment}
            />
          )
        }}
        renderGutterUtility={(getHoveredLine) => (
          <button
            className="gutter-add-btn"
            onClick={() => {
              const line = getHoveredLine()
              if (line) {
                setPending({ side: line.side, lineNumber: line.lineNumber })
              }
            }}
          >
            +
          </button>
        )}
      />
    </div>
  )
}
