import { useState, useRef, useMemo, useEffect, useImperativeHandle, forwardRef, memo } from 'react'
import { CodeView, useStableCallback, type CodeViewHandle } from '@pierre/diffs/react'
import type {
  CodeViewItem,
  CodeViewOptions,
  DiffLineAnnotation,
  FileDiffMetadata,
  AnnotationSide,
  SelectedLineRange,
  SelectionSide,
} from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'

type DraftMetadata = {
  _pending: true
  itemId: string
  side: AnnotationSide
  startLine: number
  endLine: number
}
type Metadata = ReviewComment | DraftMetadata

// Files whose +/- change count exceeds this start collapsed by default. Based
// on patch-derived stats (NOT FileDiffMetadata.unifiedLineCount) because after
// our parseDiffFromFile upgrade, unifiedLineCount is the full file's rendered
// line count, not the diff size — which would collapse every moderately-sized
// file regardless of whether the diff itself is large.
const AUTO_COLLAPSE_CHANGE_THRESHOLD = 500

export interface CodeViewWrapperHandle {
  scrollToFile(filePath: string): void
  scrollToLine(filePath: string, side: SelectionSide, lineNumber: number): void
}

interface Props {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  viewedFiles: Set<string>
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  commentCounts: Record<string, number>
  fileStatsMap: Record<string, { additions: number; deletions: number }>
  onViewedChange(filePath: string, viewed: boolean): void
  onAddComment(
    filePath: string,
    side: AnnotationSide,
    lineNumber: number,
    endLine: number,
    lineContent: string,
    body: string,
    suggestion?: { newLines: string[] },
  ): void
  onDeleteComment(id: string): void
  onReplyComment(id: string, body: string): void
  onActiveFileChange?(filePath: string | null): void
  onEditFile?(filePath: string): void
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
    // FileDiffMetadata.additionLines/deletionLines stores raw source lines
    // with trailing newlines. If we join those with '\n' we end up with '\n\n'
    // between every captured line — strip the trailing newline per row so
    // the join produces clean single-newline separation. Skip truly empty
    // rows (lineNumber outside any hunk → '') so we don't insert phantom blanks.
    const raw = getLineContent(fileDiff, side, n)
    if (raw === '') continue
    out.push(raw.replace(/\n$/, ''))
  }
  return out.join('\n')
}

function bumpVersion(item: CodeViewItem<Metadata>): number {
  const v = typeof item.version === 'number' ? item.version : 0
  return v + 1
}

// File change-type → short label. CodeView's FileDiffMetadata.type uses the
// patch-parser's vocabulary; we squash rename-pure/rename-changed since the
// distinction isn't useful at a glance.
function fileTypeLabel(type: FileDiffMetadata['type']): { label: string; cls: string } {
  switch (type) {
    case 'new':
      return { label: 'added', cls: 'pill-added' }
    case 'deleted':
      return { label: 'deleted', cls: 'pill-deleted' }
    case 'rename-pure':
    case 'rename-changed':
      return { label: 'renamed', cls: 'pill-renamed' }
    default:
      return { label: 'modified', cls: 'pill-modified' }
  }
}

// We can't rely on hunk.additionLines/deletionLines after the parseDiffFromFile
// upgrade — that path returns hunks with zero +/- counts (the upgrade is for
// expansion context, not stats). Counting from FileDiffMetadata.additionLines
// (the array of strings) is wrong too: in full-file mode it's the entire new
// file. So we hand stats in from the caller, computed off the patch text.

export const CodeViewWrapper = memo(
  forwardRef<CodeViewWrapperHandle, Props>(function CodeViewWrapper(
    {
      files,
      diffStyle,
      defaultTabSize,
      viewedFiles,
      fileAnnotationsMap,
      commentCounts,
      fileStatsMap,
      onViewedChange,
      onAddComment,
      onDeleteComment,
      onReplyComment,
      onActiveFileChange,
      onEditFile,
    },
    ref,
  ) {
    const viewerRef = useRef<CodeViewHandle<Metadata> | null>(null)
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
        scrollToLine(filePath: string, side: SelectionSide, lineNumber: number) {
          // Expand if collapsed — scrolling to a line inside a collapsed file
          // would land on the (closed) header instead of the comment.
          const viewer = viewerRef.current
          if (!viewer) return
          const item = viewer.getItem(filePath)
          if (item?.type === 'diff' && item.collapsed) {
            item.collapsed = false
            item.version = bumpVersion(item)
            viewer.updateItem(item)
          }
          viewer.scrollTo({
            type: 'line',
            id: filePath,
            lineNumber,
            side,
            align: 'center',
            behavior: 'smooth',
          })
        },
      }),
      [],
    )

    const initialItems = useMemo<CodeViewItem<Metadata>[]>(
      () => buildItems(files, fileAnnotationsMap, pending, viewedFiles, fileStatsMap),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [files],
    )

    const lastAnnotationsRef = useRef<Map<string, DiffLineAnnotation<Metadata>[]>>(new Map())
    useEffect(() => {
      const viewer = viewerRef.current
      if (!viewer) return
      for (const file of files) {
        const next = mergeAnnotations(fileAnnotationsMap.get(file.name) ?? [], pending, file.name)
        const prev = lastAnnotationsRef.current.get(file.name)
        if (annotationsEqual(prev, next)) continue
        const item = viewer.getItem(file.name)
        if (!item || item.type !== 'diff') continue
        item.annotations = next
        item.version = bumpVersion(item)
        viewer.updateItem(item)
        lastAnnotationsRef.current.set(file.name, next)
      }
    }, [files, fileAnnotationsMap, pending])

    // Viewed-state changes drive two things: re-render the header (chevron +
    // checkbox + collapsed-state) and auto-collapse the file. We treat
    // "marked viewed" as a strong signal that the user is done with this file,
    // so we collapse it; un-viewing re-expands. Header re-renders unconditionally
    // for any viewed-toggle since renderHeaderPrefix reads viewedFiles via closure.
    const lastViewedRef = useRef<Set<string>>(new Set())
    useEffect(() => {
      const viewer = viewerRef.current
      if (!viewer) return
      const prev = lastViewedRef.current
      const next = viewedFiles
      for (const file of files) {
        const before = prev.has(file.name)
        const after = next.has(file.name)
        if (before === after) continue
        const item = viewer.getItem(file.name)
        if (!item || item.type !== 'diff') continue
        // Auto-collapse on viewed, auto-expand on un-viewed. The user can
        // still manually re-expand with the chevron after marking viewed.
        item.collapsed = after
        item.version = bumpVersion(item)
        viewer.updateItem(item)
      }
      lastViewedRef.current = new Set(next)
    }, [files, viewedFiles])

    // Push comment-count changes into header metadata. We bump version for
    // any file whose count changed so renderHeaderMetadata re-runs.
    const lastCountsRef = useRef<Record<string, number>>({})
    useEffect(() => {
      const viewer = viewerRef.current
      if (!viewer) return
      const prev = lastCountsRef.current
      for (const file of files) {
        const before = prev[file.name] ?? 0
        const after = commentCounts[file.name] ?? 0
        if (before === after) continue
        const item = viewer.getItem(file.name)
        if (!item || item.type !== 'diff') continue
        item.version = bumpVersion(item)
        viewer.updateItem(item)
      }
      lastCountsRef.current = commentCounts
    }, [files, commentCounts])

    // Same idea for stats: bump version if a file's stats change so the
    // metadata cell rerenders. In practice stats don't change for a given
    // diff identity (the viewerKey remount catches identity changes), but
    // this keeps the data path consistent.
    const lastStatsRef = useRef<Record<string, { additions: number; deletions: number }>>({})
    useEffect(() => {
      const viewer = viewerRef.current
      if (!viewer) return
      const prev = lastStatsRef.current
      for (const file of files) {
        const a = prev[file.name]
        const b = fileStatsMap[file.name]
        if (a?.additions === b?.additions && a?.deletions === b?.deletions) continue
        const item = viewer.getItem(file.name)
        if (!item || item.type !== 'diff') continue
        item.version = bumpVersion(item)
        viewer.updateItem(item)
      }
      lastStatsRef.current = fileStatsMap
    }, [files, fileStatsMap])

    // Track whether the user is mid-drag (line selection or gutter-utility
    // selection). onLineEnter fires per-line during the drag, and we must
    // NOT clear the selection while it's still being built — that would wipe
    // every range the moment the cursor crossed a fresh line.
    const isSelectingRef = useRef(false)

    // Clear the lib's line selection when the user hovers a line outside the
    // currently selected range. See the enableLineSelection comment in the
    // options block for the why.
    const handleLineEnter = useStableCallback(
      (
        props: { lineNumber: number },
        ctx: { item: CodeViewItem<Metadata> },
      ) => {
        if (isSelectingRef.current) return
        const viewer = viewerRef.current
        if (!viewer || !ctx?.item) return
        const sel = viewer.getSelectedLines()
        if (!sel) return
        if (sel.id !== ctx.item.id) {
          viewer.clearSelectedLines()
          return
        }
        const lo = Math.min(sel.range.start, sel.range.end)
        const hi = Math.max(sel.range.start, sel.range.end)
        if (props.lineNumber < lo || props.lineNumber > hi) viewer.clearSelectedLines()
      },
    )

    const handleGutterClick = useStableCallback(
      (
        range: SelectedLineRange,
        context: { item: CodeViewItem<Metadata> },
      ) => {
        if (context.item.type !== 'diff') return
        if (pending) return
        // Pick whichever side the drag ended on; if neither is set (rare —
        // typically only on synthetic events), fall back to additions since
        // that's where reviewers comment the vast majority of the time. We
        // do NOT bail on cross-side ranges: in split view the + button is
        // anchored on one column (often deletions) while the coordinate-
        // resolved drag endpoint lands on whichever column the cursor is in.
        // Cross-side just means "started here, ended there" — commit to one.
        const side = range.endSide ?? range.side ?? 'additions'
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
                originalLines={getRangeContent(
                  item.fileDiff,
                  p.side,
                  p.startLine,
                  p.endLine,
                )}
                onSubmit={(body, suggestion) => {
                  const lineContent = getRangeContent(
                    item.fileDiff,
                    p.side,
                    p.startLine,
                    p.endLine,
                  )
                  onAddComment(
                    p.itemId,
                    p.side,
                    p.startLine,
                    p.endLine,
                    lineContent,
                    body,
                    suggestion,
                  )
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

    const handleToggleCollapse = useStableCallback((itemId: string) => {
      const viewer = viewerRef.current
      if (!viewer) return
      const item = viewer.getItem(itemId)
      if (!item || item.type !== 'diff') return
      item.collapsed = item.collapsed !== true
      item.version = bumpVersion(item)
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
            {onEditFile && (
              <button
                type="button"
                className="codeview-edit-btn"
                title="Edit file in browser"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onEditFile(item.id)
                }}
              >
                Edit
              </button>
            )}
          </div>
        )
      },
    )

    const renderHeaderMetadata = useStableCallback(
      (item: CodeViewItem<Metadata>) => {
        if (item.type !== 'diff') return null
        const { label, cls } = fileTypeLabel(item.fileDiff.type)
        const stats = fileStatsMap[item.id]
        const additions = stats?.additions ?? 0
        const deletions = stats?.deletions ?? 0
        const count = commentCounts[item.id] ?? 0
        return (
          <div className="codeview-header-meta">
            <span className={`cv-pill ${cls}`}>{label}</span>
            {additions > 0 && <span className="cv-stat cv-add">+{additions}</span>}
            {deletions > 0 && <span className="cv-stat cv-del">−{deletions}</span>}
            {count > 0 && (
              <span className="cv-stat cv-comments" title={`${count} comment${count === 1 ? '' : 's'}`}>
                💬 {count}
              </span>
            )}
          </div>
        )
      },
    )

    const activeOffset = 80
    const lastActiveFileRef = useRef<string | null>(null)
    const rafIdRef = useRef<number | null>(null)
    const handleScroll = useStableCallback((scrollTop: number) => {
      if (!onActiveFileChange) return
      if (rafIdRef.current != null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
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
        // Line selection is on (so drag-to-select-range works visually), but
        // we auto-clear the selection in onLineEnter when the user hovers a
        // line outside the selected range. Without that clear, the lib glues
        // the '+' button to the most recently clicked line and ignores
        // subsequent hovers — users hover line Y, press where the '+' looks
        // like it should be, but pointerdown lands on empty gutter and the
        // lib starts a line-select drag instead of a gutter-utility drag, so
        // no comment form opens. Clearing on hover-away restores the
        // "+ tracks hover" behavior while preserving in-drag visualization.
        enableLineSelection: true,
        stickyHeaders: true,
        lineHoverHighlight: 'number' as const,
        // Tab size + inverse-sticky shadow. The @container scroll-state trick
        // (cribbed from diffshub) only paints the hairline under a header when
        // it's *actually stuck* at the top — much quieter than always-on.
        unsafeCSS: `
          :host { --diffs-tab-size: ${defaultTabSize}; }
          [data-diffs-header] {
            container-type: scroll-state;
            container-name: diffx-sticky-header;
          }
          @container diffx-sticky-header scroll-state(stuck: top) {
            [data-diffs-header]::after {
              position: absolute;
              bottom: -1px;
              left: 0;
              width: 100%;
              height: 1px;
              content: '';
              background-color: var(--color-border-opaque, currentColor);
              opacity: 0.4;
            }
          }
        `,
        onGutterUtilityClick: (range, context) => handleGutterClick(range, context),
        // Lib wraps onLineEnter via defineItemSharedCallback to inject a
        // second arg {item}. The cast keeps us in lockstep with that shape.
        onLineEnter: ((props: unknown, ctx: unknown) =>
          handleLineEnter(
            props as { lineNumber: number },
            ctx as { item: CodeViewItem<Metadata> },
          )) as never,
        // Mid-drag the user is still building their selection; the auto-clear
        // in onLineEnter would otherwise wipe each newly-crossed line.
        onLineSelectionStart: () => {
          isSelectingRef.current = true
        },
        onLineSelectionEnd: () => {
          isSelectingRef.current = false
        },
      }),
      [diffStyle, defaultTabSize, handleGutterClick, handleLineEnter],
    )

    return (
      <CodeView<Metadata>
        ref={(v) => {
          viewerRef.current = v
        }}
        containerRef={scrollRef}
        initialItems={initialItems}
        options={options}
        onScroll={handleScroll}
        renderAnnotation={renderAnnotation}
        renderHeaderPrefix={renderHeaderPrefix}
        renderHeaderMetadata={renderHeaderMetadata}
        className="codeview-surface"
      />
    )
  }),
)

function buildItems(
  files: FileDiffMetadata[],
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>,
  pending: DraftMetadata | null,
  viewedFiles: Set<string>,
  fileStatsMap: Record<string, { additions: number; deletions: number }>,
): CodeViewItem<Metadata>[] {
  return files.map((fileDiff) => {
    const stats = fileStatsMap[fileDiff.name]
    const changeCount = (stats?.additions ?? 0) + (stats?.deletions ?? 0)
    // Initial collapse: viewed files (carryover from a prior session) and
    // very large diffs. Manual chevron toggle still overrides.
    const collapsed =
      viewedFiles.has(fileDiff.name) || changeCount > AUTO_COLLAPSE_CHANGE_THRESHOLD
    return {
      id: fileDiff.name,
      type: 'diff' as const,
      fileDiff,
      collapsed,
      annotations: mergeAnnotations(
        fileAnnotationsMap.get(fileDiff.name) ?? [],
        pending,
        fileDiff.name,
      ),
      version: 0,
    }
  })
}

function mergeAnnotations(
  persisted: DiffLineAnnotation<ReviewComment>[],
  pending: DraftMetadata | null,
  fileName: string,
): DiffLineAnnotation<Metadata>[] {
  if (!pending || pending.itemId !== fileName) return persisted
  return [
    ...persisted,
    {
      side: pending.side,
      lineNumber: pending.endLine,
      metadata: pending,
    },
  ]
}

function annotationsEqual(
  a: DiffLineAnnotation<Metadata>[] | undefined,
  b: DiffLineAnnotation<Metadata>[],
): boolean {
  if (a === b) return true
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].metadata !== b[i].metadata) return false
    if (a[i].lineNumber !== b[i].lineNumber) return false
    if (a[i].side !== b[i].side) return false
  }
  return true
}
