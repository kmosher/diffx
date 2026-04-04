import { useState, useMemo } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import { useDiff } from './hooks/useDiff'
import { useComments } from './hooks/useComments'
import { Toolbar } from './components/Toolbar'
import { DiffViewer } from './components/DiffViewer'

export function App() {
  const { patch, repoName, loading, error } = useDiff()
  const { comments, addComment, removeComment, getAnnotationsForFile, copyAllComments } =
    useComments()
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split')

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      return parsed.flatMap((p) => p.files)
    } catch {
      return []
    }
  }, [patch])

  if (loading) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error">
        <p>Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar
        repoName={repoName}
        fileCount={files.length}
        commentCount={comments.length}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        onCopyComments={copyAllComments}
      />
      <main className="main">
        <DiffViewer
          files={files}
          diffStyle={diffStyle}
          getAnnotationsForFile={getAnnotationsForFile}
          onAddComment={addComment}
          onDeleteComment={removeComment}
        />
      </main>
    </div>
  )
}
