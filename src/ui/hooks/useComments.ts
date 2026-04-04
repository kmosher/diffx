import { useState, useCallback } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../../types'

let nextId = Date.now()

export function useComments() {
  const [comments, setComments] = useState<ReviewComment[]>([])

  const addComment = useCallback(
    (filePath: string, side: 'deletions' | 'additions', lineNumber: number, lineContent: string, body: string) => {
      const comment: ReviewComment = {
        id: String(nextId++),
        filePath,
        side,
        lineNumber,
        lineContent,
        body,
        createdAt: Date.now(),
      }
      setComments((prev) => [...prev, comment])
    },
    [],
  )

  const removeComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const editComment = useCallback((id: string, body: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, body } : c)))
  }, [])

  const formatAllComments = useCallback((): string => {
    if (comments.length === 0) return ''

    const grouped = new Map<string, ReviewComment[]>()
    for (const comment of comments) {
      const list = grouped.get(comment.filePath) ?? []
      list.push(comment)
      grouped.set(comment.filePath, list)
    }

    const lines: string[] = ['<code-review-comments>']
    for (const [filePath, fileComments] of grouped) {
      lines.push(`<file path="${filePath}">`)
      for (const comment of fileComments) {
        lines.push(`<comment line="${comment.lineNumber}">`)
        const prefix = comment.side === 'additions' ? '+' : '-'
        lines.push(`<code>${prefix} ${comment.lineContent}</code>`)
        lines.push(comment.body)
        lines.push('</comment>')
      }
      lines.push('</file>')
    }
    lines.push('</code-review-comments>')

    return lines.join('\n')
  }, [comments])

  const getAnnotationsForFile = useCallback(
    (filePath: string): DiffLineAnnotation<ReviewComment>[] => {
      return comments
        .filter((c) => c.filePath === filePath)
        .map((c) => ({
          side: c.side,
          lineNumber: c.lineNumber,
          metadata: c,
        }))
    },
    [comments],
  )

  const copyAllComments = useCallback(async () => {
    const text = formatAllComments()
    await navigator.clipboard.writeText(text)
  }, [formatAllComments])

  return {
    comments,
    addComment,
    removeComment,
    editComment,
    getAnnotationsForFile,
    formatAllComments,
    copyAllComments,
  }
}
