import { useState, useMemo, useCallback, useRef } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useComments } from './hooks/useComments'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { Toolbar } from './components/Toolbar'
import { DiffViewer } from './components/DiffViewer'
import { FileTree } from './components/FileTree'
import type { FileCommentStatus } from './components/FileTree'
import { CommentList } from './components/CommentList'

export function App() {
  const { settings, loaded, updateSettings } = useSettings()
  const { patch, repoName, branch, customMode, binaryFiles, tabSizeMap, untrackedFiles, loading, error } = useDiff({
    staged: settings.staged,
    untracked: settings.untracked,
  })
  const { comments, addComment, removeComment, copyAllComments } =
    useComments()
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'files' | 'comments'>('files')
  const { viewedFiles, setViewed } = useViewed()
  const diffViewerRef = useRef<HTMLDivElement>(null)

  const untrackedSet = useMemo(() => new Set(untrackedFiles), [untrackedFiles])

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const parsedFiles = parsed.flatMap((p) => p.files)

      // Add synthetic entries for binary files not already in parsed output
      const existingNames = new Set(parsedFiles.map((f) => f.name))
      for (const bf of binaryFiles) {
        if (!existingNames.has(bf.path)) {
          const syntheticFile: FileDiffMetadata = {
            name: bf.path,
            type: bf.type === 'added' || bf.type === 'untracked' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
            hunks: [],
            splitLineCount: 0,
            unifiedLineCount: 0,
            isPartial: true,
            deletionLines: [],
            additionLines: [],
          }
          parsedFiles.push(syntheticFile)
        }
      }

      return parsedFiles
    } catch {
      return []
    }
  }, [patch, binaryFiles])

  const diffStats = useMemo(() => {
    if (!patch) return { additions: 0, deletions: 0 }
    let additions = 0
    let deletions = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }, [patch])

  const binaryFileMap = useMemo(() => {
    const map = new Map<string, (typeof binaryFiles)[number]>()
    for (const bf of binaryFiles) {
      map.set(bf.path, bf)
    }
    return map
  }, [binaryFiles])

  const openCount = useMemo(() => comments.filter((c) => c.status === 'open').length, [comments])
  const resolvedCount = useMemo(() => comments.filter((c) => c.status === 'resolved').length, [comments])

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of comments) {
      counts[c.filePath] = (counts[c.filePath] ?? 0) + 1
    }
    return counts
  }, [comments])

  const commentStatusMap = useMemo(() => {
    const map: Record<string, FileCommentStatus> = {}
    for (const c of comments) {
      if (!map[c.filePath]) {
        map[c.filePath] = { open: 0, resolved: 0, total: 0 }
      }
      map[c.filePath].total++
      if (c.status === 'open') map[c.filePath].open++
      else map[c.filePath].resolved++
    }
    return map
  }, [comments])

  const fileAnnotationsMap = useMemo(() => {
    const map = new Map<string, { side: ReviewComment['side']; lineNumber: number; metadata: ReviewComment }[]>()
    for (const c of comments) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push({
        side: c.side,
        lineNumber: c.lineNumber,
        metadata: c,
      })
    }
    return map
  }, [comments])

  const handleFileClick = useCallback((filePath: string) => {
    setActiveFile(filePath)
    const el = document.getElementById(`file-${filePath}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
    }
  }, [])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
  }, [setViewed])

  if (!loaded || loading) {
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
        branch={branch}
        fileCount={files.length}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        commentCount={comments.length}
        openCount={openCount}
        resolvedCount={resolvedCount}
        diffStyle={settings.diffStyle}
        diffOptions={{ staged: settings.staged, untracked: settings.untracked }}
        defaultTabSize={settings.defaultTabSize}
        customMode={customMode}
        onDiffStyleChange={(style) => updateSettings({ diffStyle: style })}
        onDiffOptionsChange={(options) => updateSettings(options)}
        onDefaultTabSizeChange={(size) => updateSettings({ defaultTabSize: size })}
        onCopyComments={copyAllComments}
      />
      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${sidebarTab === 'files' ? 'sidebar-tab-active' : ''}`}
              onClick={() => setSidebarTab('files')}
            >
              Files
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'comments' ? 'sidebar-tab-active' : ''}`}
              onClick={() => setSidebarTab('comments')}
            >
              Comments
              {openCount > 0 && (
                <span className="sidebar-tab-badge sidebar-tab-badge-open">{openCount}</span>
              )}
            </button>
          </div>
          {sidebarTab === 'files' ? (
            <FileTree
              files={files}
              activeFile={activeFile}
              commentCounts={commentCounts}
              commentStatusMap={commentStatusMap}
              viewedFiles={viewedFiles}
              untrackedFiles={untrackedSet}
              onFileClick={handleFileClick}
            />
          ) : (
            <CommentList
              comments={comments}
              onNavigate={(filePath) => {
                handleFileClick(filePath)
                setSidebarTab('files')
              }}
            />
          )}
        </aside>
        <main className="main" ref={diffViewerRef}>
          <DiffViewer
            files={files}
            diffStyle={settings.diffStyle}
            tabSizeMap={tabSizeMap}
            defaultTabSize={settings.defaultTabSize}
            viewedFiles={viewedFiles}
            binaryFiles={binaryFileMap}
            onViewedChange={handleViewedChange}
            fileAnnotationsMap={fileAnnotationsMap}
            onAddComment={addComment}
            onDeleteComment={removeComment}
          />
        </main>
      </div>
    </div>
  )
}
