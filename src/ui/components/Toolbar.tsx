import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { DiffOptions } from '../hooks/useDiff'

interface ToolbarProps {
  repoName: string
  branch: string
  fileCount: number
  additions: number
  deletions: number
  commentCount: number
  diffStyle: 'split' | 'unified'
  diffOptions: DiffOptions
  customMode: boolean
  onDiffStyleChange: (style: 'split' | 'unified') => void
  onDiffOptionsChange: (options: DiffOptions) => void
  onCopyComments: () => Promise<void>
}

export function Toolbar({
  repoName,
  branch,
  fileCount,
  additions,
  deletions,
  commentCount,
  diffStyle,
  diffOptions,
  customMode,
  onDiffStyleChange,
  onDiffOptionsChange,
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
        {branch && (
          <span className="toolbar-branch">
            <GitBranch size={12} />
            {branch}
          </span>
        )}
        <span className="toolbar-stat">
          {fileCount} file{fileCount !== 1 ? 's' : ''} changed
          {additions > 0 && <span className="stat-additions"> +{additions}</span>}
          {deletions > 0 && <span className="stat-deletions"> -{deletions}</span>}
        </span>
      </div>
      <div className="toolbar-right">
        {!customMode && (
          <>
            <label className="toolbar-checkbox">
              <input
                type="checkbox"
                checked={diffOptions.staged}
                onChange={(e) =>
                  onDiffOptionsChange({ ...diffOptions, staged: e.target.checked })
                }
              />
              Staged
            </label>
            <label className="toolbar-checkbox">
              <input
                type="checkbox"
                checked={diffOptions.untracked}
                onChange={(e) =>
                  onDiffOptionsChange({ ...diffOptions, untracked: e.target.checked })
                }
              />
              Untracked
            </label>
          </>
        )}
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
          className="btn btn-primary btn-sm"
          onClick={handleCopy}
          disabled={commentCount === 0}
        >
          {copied ? 'Copied!' : `Copy comments (${commentCount})`}
        </button>
      </div>
    </div>
  )
}
