import { useState, useRef, useEffect } from 'react'

interface CommentFormProps {
  // Original line content selected for the comment; required for suggest-mode
  // (we pre-fill the suggestion textarea with it). Single-line: one string; range:
  // newline-joined. Empty string is treated as "no original content captured."
  originalLines?: string
  onSubmit: (body: string, suggestion?: { newLines: string[] }) => void
  onCancel: () => void
}

export function CommentForm({ originalLines = '', onSubmit, onCancel }: CommentFormProps) {
  const [body, setBody] = useState('')
  const [suggestMode, setSuggestMode] = useState(false)
  const [suggestionText, setSuggestionText] = useState(originalLines)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const suggestionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bodyRef.current?.focus()
  }, [])

  useEffect(() => {
    if (suggestMode) {
      // Refocus into the suggestion textarea when entering suggest mode so the
      // user can start typing the rewrite immediately.
      requestAnimationFrame(() => suggestionRef.current?.focus())
    }
  }, [suggestMode])

  const handleSubmit = () => {
    const trimmedBody = body.trim()
    if (suggestMode) {
      // In suggest mode, the rewrite is the payload — the body is optional
      // commentary. Allow submit if suggestion differs from original OR body
      // has content; reject if both are empty/unchanged (would be a no-op).
      const changed = suggestionText !== originalLines
      if (!changed && !trimmedBody) return
      onSubmit(trimmedBody, { newLines: suggestionText.split('\n') })
      return
    }
    if (trimmedBody) {
      onSubmit(trimmedBody)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  const submitLabel = suggestMode ? 'Suggest rewrite' : 'Comment'
  const submitDisabled = suggestMode
    ? suggestionText === originalLines && !body.trim()
    : !body.trim()

  return (
    <div className="comment-form">
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          suggestMode
            ? 'Optional: explain the rewrite...'
            : 'Leave a review comment...'
        }
        rows={suggestMode ? 2 : 3}
      />
      {suggestMode && (
        <textarea
          ref={suggestionRef}
          className="comment-suggestion-textarea"
          value={suggestionText}
          onChange={(e) => setSuggestionText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Suggested rewrite..."
          spellCheck={false}
          rows={Math.max(3, suggestionText.split('\n').length + 1)}
        />
      )}
      <div className="comment-form-actions">
        <button
          type="button"
          className={`btn btn-ghost ${suggestMode ? 'btn-ghost-active' : ''}`}
          onClick={() => setSuggestMode((m) => !m)}
          title="Toggle inline rewrite suggestion"
        >
          {suggestMode ? 'Cancel suggest' : 'Suggest edit'}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitDisabled}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
