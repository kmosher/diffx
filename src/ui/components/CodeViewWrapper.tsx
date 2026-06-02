import { useState, useRef, useMemo, useImperativeHandle, forwardRef, memo } from 'react'
import { CodeView, useStableCallback, type CodeViewHandle } from '@pierre/diffs/react'
import type {
  CodeViewItem,
  CodeViewOptions,
  DiffLineAnnotation,
  FileDiffMetadata,
  AnnotationSide,
  SelectedLineRange,
} from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'

// Discriminated union on `_pending`. Persisted comments are `ReviewComment`s
// straight from the server; the in-flight draft (only one at a time) carries
// the gutter-selected range so we can reconstruct line content on submit.
type DraftMetadata = {
  _pending: true
  itemId: string
  side: AnnotationSide
  startLine: number
  endLine: number
}
type Metadata = ReviewComment | DraftMetadata

export interface CodeViewWrapperHandle {
  scrollToFile(filePath: string): void
}

interface Props {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  viewedFiles: Set<string>
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onViewedChange(filePath: string, viewed: boolean): void
  onAddComment(
    filePath: string,
    side: AnnotationSide,
    lineNumber: number,
    endLine: number,
    lineContent: string,
    body: string,
  ): void
  onDeleteComment(id: string): void
  onReplyComment(id: string, body: string): void
  // Fires when the scroll position crosses into a different file's
  // territory, used by the file tree to highlight the currently-visible
  // file. Throttled to one call per animation frame and deduped against
  // the last reported value, so listener side-effects (setState) don't
  // tear during rapid scroll.
  onActiveFileChange?(filePath: string | null): void
}

function getLineContent(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  lineNumber: number,
): string {
  const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
  const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
  const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
  const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
  for (const hunk of fileDiff.hunks) {
    const start = hunk[startKey]
    const count = hunk[countKey]
    if (lineNumber >= start && lineNumber < start + count) {
      const index = hunk[indexKey] + (lineNumber - start)
      return lines[index] ?? ''
    }
  }
  return ''
}

function getRangeContent(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  startLine: number,
  endLine: number,
): string {
  const out: string[] = []
  for (let n = startLine; n <= endLine; n++) {
    const line = getLineContent(fileDiff, side, n)
    if (line !== '') out.push(line)
  }
  return out.join('\n')
}

export const CodeViewWrapper = memo(
  forwardRef<CodeViewWrapperHandle, Props>(function CodeViewWrapper(
    {
      files,
      diffStyle,
      defaultTabSize,
      viewedFiles,
      fileAnnotationsMap,
      onViewedChange,
      onAddComment,
      onDeleteComment,
      onReplyComment,
      onActiveFileChange,
    },
    ref,
  ) {
    const viewerRef = useRef<CodeViewHandle<Metadata> | null>(null)
    // The CodeView element is its own scroll container — overflow-y:auto in
    // .codeview-surface CSS. CodeView reads scrollTop off whatever DOM node
    // containerRef resolves to in order to drive virtualization.
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const [pending, setPending] = useState<DraftMetadata | null>(null)

    useImperativeHandle(
      ref,
      () => ({
        scrollToFile(filePath: string) {
          viewerRef.current?.scrollTo({
            type: 'item',
            id: filePath,
            align: 'start',
            behavior: 'smooth',
          })
        },
      }),
      [],
    )

    // Build CodeViewItem[] from parsed files + comments + pending draft.
    // Controlled mode: items re-derived on every change. CodeView diffs by id
    // so unchanged files don't re-tokenize. If this proves too thrashy we
    // can switch to initialItems + imperative viewer.updateItem (diffshub pattern).
    const items = useMemo<CodeViewItem<Metadata>[]>(() => {
      return files.map((fileDiff) => {
        const persisted = fileAnnotationsMap.get(fileDiff.name) ?? []
        const annotations: DiffLineAnnotation<Metadata>[] =
          pending && pending.itemId === fileDiff.name
            ? [
                ...persisted,
                {
                  side: pending.side,
                  lineNumber: pending.endLine,
                  metadata: pending,
                },
              ]
            : persisted
        return {
          id: fileDiff.name,
          type: 'diff' as const,
          fileDiff,
          annotations,
          version: 0,
        }
      })
    }, [files, fileAnnotationsMap, pending])

    const handleGutterClick = useStableCallback(
      (
        range: SelectedLineRange,
        context: { item: CodeViewItem<Metadata> },
      ) => {
        if (context.item.type !== 'diff') return
        // Don't clobber an in-progress comment form — the user may have typed text.
        if (pending) return
        const side = range.endSide ?? range.side
        if (!side) return
        // Cross-side drag on a split diff: each side has its own line-number
        // coordinate space, no single span possible.
        if (range.side && range.endSide && range.side !== range.endSide) return
        setPending({
          _pending: true,
          itemId: context.item.id,
          side,
          startLine: Math.min(range.start, range.end),
          endLine: Math.max(range.start, range.end),
        })
      },
    )

    const renderAnnotation = useStableCallback(
      (
        annotation: DiffLineAnnotation<Metadata>,
        item: CodeViewItem<Metadata>,
      ) => {
        if (item.type !== 'diff') return null
        if ('_pending' in annotation.metadata) {
          const p = annotation.metadata
          const rangeLabel =
            p.endLine > p.startLine
              ? `Commenting on lines ${p.startLine}–${p.endLine}`
              : null
          return (
            <div>
              {rangeLabel && <div className="comment-range-label">{rangeLabel}</div>}
              <CommentForm
                onSubmit={(body) => {
                  const lineContent = getRangeContent(
                    item.fileDiff,
                    p.side,
                    p.startLine,
                    p.endLine,
                  )
                  onAddComment(p.itemId, p.side, p.startLine, p.endLine, lineContent, body)
                  setPending(null)
                }}
                onCancel={() => setPending(null)}
              />
            </div>
          )
        }
        return (
          <CommentBubble
            comment={annotation.metadata as ReviewComment}
            onDelete={onDeleteComment}
            onReply={onReplyComment}
          />
        )
      },
    )

    // Imperatively toggle item.collapsed on the viewer. Bumping item.version
    // tells CodeView to re-render this single item without rebuilding the
    // whole items array.
    const handleToggleCollapse = useStableCallback((itemId: string) => {
      const viewer = viewerRef.current
      if (!viewer) return
      const item = viewer.getItem(itemId)
      if (!item || item.type !== 'diff') return
      item.collapsed = item.collapsed !== true
      item.version = (typeof item.version === 'number' ? item.version : 0) + 1
      viewer.updateItem(item)
    })

    const renderHeaderPrefix = useStableCallback(
      (item: CodeViewItem<Metadata>) => {
        if (item.type !== 'diff') return null
        const viewed = viewedFiles.has(item.id)
        const empty =
          item.fileDiff.splitLineCount === 0 && item.fileDiff.unifiedLineCount === 0
        return (
          <div className="codeview-header-prefix">
            <button
              type="button"
              className="codeview-collapse-btn"
              disabled={empty}
              aria-expanded={!item.collapsed}
              aria-label={item.collapsed ? 'Expand diff' : 'Collapse diff'}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleToggleCollapse(item.id)
              }}
            >
              {/* Unicode chevron-right; rotates 90deg when expanded via CSS */}
              <span className={`chevron ${item.collapsed ? '' : 'chevron-down'}`}>›</span>
            </button>
            <label
              className="viewed-label"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={viewed}
                onChange={(e) => onViewedChange(item.id, e.target.checked)}
              />
              Viewed
            </label>
          </div>
        )
      },
    )

    // Active-file tracking on scroll. Walk items, find the one whose top is
    // <= scrollTop + activeOffset and is greatest — that's the file the user
    // is currently looking at. rAF-throttled so we report at most once per
    // frame; deduped against the last reported value so listener setState
    // doesn't fire when scrolling within one file.
    const activeOffset = 80 // px below viewport top where a header counts as "in view"
    const lastActiveFileRef = useRef<string | null>(null)
    const rafIdRef = useRef<number | null>(null)
    const handleScroll = useStableCallback((scrollTop: number) => {
      if (!onActiveFileChange) return
      if (rafIdRef.current != null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        // getTopForItem lives on the underlying CodeView instance, not on
        // the React handle. May be undefined briefly during initial mount.
        const instance = viewerRef.current?.getInstance()
        if (!instance) return
        let active: string | null = null
        let bestTop = -Infinity
        for (const file of files) {
          const top = instance.getTopForItem(file.name)
          if (top == null) continue
          if (top <= scrollTop + activeOffset && top > bestTop) {
            bestTop = top
            active = file.name
          }
        }
        if (active !== lastActiveFileRef.current) {
          lastActiveFileRef.current = active
          onActiveFileChange(active)
        }
      })
    })

    const options: CodeViewOptions<Metadata> = useMemo(
      () => ({
        diffStyle,
        themeType: 'system' as const,
        theme: { dark: 'github-dark' as const, light: 'github-light' as const },
        enableGutterUtility: true,
        enableLineSelection: true,
        stickyHeaders: true,
        lineHoverHighlight: 'number' as const,
        // Tab size moves from per-file to global. Per-file via unsafeCSS no
        // longer works because the CodeView surface is a single web component
        // for all files. Revisit if per-language tab size matters in practice.
        unsafeCSS: `:host { --diffs-tab-size: ${defaultTabSize}; }`,
        onGutterUtilityClick: (range, context) => handleGutterClick(range, context),
      }),
      [diffStyle, defaultTabSize, handleGutterClick],
    )

    return (
      <CodeView<Metadata>
        ref={(v) => {
          viewerRef.current = v
        }}
        containerRef={scrollRef}
        items={items}
        options={options}
        onScroll={handleScroll}
        renderAnnotation={renderAnnotation}
        renderHeaderPrefix={renderHeaderPrefix}
        className="codeview-surface"
      />
    )
  }),
)
