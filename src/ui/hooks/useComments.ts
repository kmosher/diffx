import { useState, useCallback } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../../types'

let nextId = Date.now()

export function useComments() {
  const [comments, setComments] = useState<ReviewComment[]>([])

  const addComment = useCallback(
    (filePath: string, side: 'deletions' | 'additions', lineNumber: number, body: string) => {
      const comment: ReviewComment = {
        id: String(nextId++),
        filePath,
        side,
        lineNumber,
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

    const lines: string[] = ['# Code Review Comments', '']
    for (const [filePath, fileComments] of grouped) {
      lines.push(`## ${filePath}`, '')
      for (const comment of fileComments) {
        lines.push(`### Line ${comment.lineNumber} (${comment.side})`, '')
        lines.push(comment.body, '')
      }
    }

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
