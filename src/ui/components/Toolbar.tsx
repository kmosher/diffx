import { useState } from 'react'

interface ToolbarProps {
  repoName: string
  fileCount: number
  commentCount: number
  diffStyle: 'split' | 'unified'
  onDiffStyleChange: (style: 'split' | 'unified') => void
  onCopyComments: () => Promise<void>
}

export function Toolbar({
  repoName,
  fileCount,
  commentCount,
  diffStyle,
  onDiffStyleChange,
  onCopyComments,
}: ToolbarProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await onCopyComments()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <h1 className="toolbar-title">{repoName}</h1>
        <span className="toolbar-stat">
          {fileCount} file{fileCount !== 1 ? 's' : ''} changed
        </span>
      </div>
      <div className="toolbar-right">
        <div className="toolbar-toggle">
          <button
            className={`btn btn-sm ${diffStyle === 'split' ? 'btn-active' : ''}`}
            onClick={() => onDiffStyleChange('split')}
          >
            Split
          </button>
          <button
            className={`btn btn-sm ${diffStyle === 'unified' ? 'btn-active' : ''}`}
            onClick={() => onDiffStyleChange('unified')}
          >
            Unified
          </button>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleCopy}
          disabled={commentCount === 0}
        >
          {copied ? 'Copied!' : `Copy All Comments (${commentCount})`}
        </button>
      </div>
    </div>
  )
}
