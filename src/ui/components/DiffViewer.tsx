import type { FileDiffMetadata, DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { FileDiffCard } from './FileDiffCard'

interface DiffViewerProps {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  viewedFiles: Set<string>
  onViewedChange: (filePath: string, viewed: boolean) => void
  getAnnotationsForFile: (filePath: string) => DiffLineAnnotation<ReviewComment>[]
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, body: string) => void
  onDeleteComment: (id: string) => void
}

export function DiffViewer({
  files,
  diffStyle,
  viewedFiles,
  onViewedChange,
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
        const filePath = file.name
        return (
          <FileDiffCard
            key={`${filePath}-${index}`}
            id={`file-${filePath}`}
            fileDiff={file}
            filePath={filePath}
            annotations={getAnnotationsForFile(filePath)}
            diffStyle={diffStyle}
            viewed={viewedFiles.has(filePath)}
            onViewedChange={onViewedChange}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
          />
        )
      })}
    </div>
  )
}
