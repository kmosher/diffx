import { useState, useEffect, useRef } from 'react'

interface Props {
  filePath: string
  initialContents: string
  onClose: () => void
  // Resolved when the server confirms the write. The caller should rely on the
  // SSE 'file-written' broadcast (via useDiff) to refresh the diff view;
  // returning a fulfilled promise here only signals success/failure for the
  // editor's local state.
  onSave: (contents: string) => Promise<void>
}

// Modal text editor. Intentionally a plain textarea today — the long-term
// plan is to drop in Monaco (or CodeMirror 6) at this seam without changing
// the surrounding wiring. Keeping the interface minimal (initialContents in,
// onSave out) means the swap is a one-component change.
export function FileEditorModal({ filePath, initialContents, onClose, onSave }: Props) {
  const [contents, setContents] = useState(initialContents)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const dirty = contents !== initialContents

  const handleSave = async () => {
    if (!dirty || saving) return
    setSaving(true)
    setErr(null)
    try {
      await onSave(contents)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (dirty) {
        if (!confirm('Discard unsaved edits?')) return
      }
      onClose()
    }
    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <div className="editor-modal-backdrop" onClick={onClose}>
      <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="editor-modal-header">
          <span className="editor-modal-path">{filePath}</span>
          {dirty && <span className="editor-modal-dirty">• unsaved</span>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!dirty || saving}
            title="Save (⌘S)"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {err && <div className="editor-modal-error">{err}</div>}
        <textarea
          ref={taRef}
          className="editor-modal-textarea"
          value={contents}
          onChange={(e) => setContents(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
