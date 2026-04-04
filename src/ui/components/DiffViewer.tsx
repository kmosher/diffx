import type { FileDiffMetadata, DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { FileDiffCard } from './FileDiffCard'

interface DiffViewerProps {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  getAnnotationsForFile: (filePath: string) => DiffLineAnnotation<ReviewComment>[]
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, body: string) => void
  onDeleteComment: (id: string) => void
}

function getFilePath(file: FileDiffMetadata): string {
  return file.name
}

export function DiffViewer({
  files,
  diffStyle,
  getAnnotationsForFile,
  onAddComment,
  onDeleteComment,
}: DiffViewerProps) {
  if (files.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
      </div>
    )
  }

  return (
    <div className="diff-viewer">
      {files.map((file, index) => {
        const filePath = getFilePath(file)
        return (
          <FileDiffCard
            key={`${filePath}-${index}`}
            fileDiff={file}
            filePath={filePath}
            annotations={getAnnotationsForFile(filePath)}
            diffStyle={diffStyle}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
          />
        )
      })}
    </div>
  )
}
