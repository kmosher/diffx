---
name: diffx-review
description: "Code review workflow using the diffx CLI. Use when the user invokes /diffx-review to review their git changes in a browser-based UI, add inline comments, and have Claude process and apply the feedback."
user_invocable: true
---

# diffx Code Review

This skill orchestrates a code review workflow using `diffx`, a local tool that opens a GitHub PR-like web UI for reviewing git diffs. The user reviews their changes in the browser, leaves inline comments, and you then process those comments to fix or improve the code.

## The workflow

### 1. Launch diffx

Run `diffx` to open the review UI. By default it shows all working tree changes (staged + unstaged + untracked).

```bash
diffx
```

Common variations — use these when the context calls for it:

```bash
diffx -- --staged          # Only staged changes
diffx -- HEAD~3            # Last 3 commits
diffx -- main..HEAD        # Current branch vs main
diffx -p 8080             # Custom port (default: 3433)
diffx --no-open           # Start server without opening browser
```

Anything after `--` is passed directly to `git diff`, so any valid git diff arguments work.

### 2. Tell the user what to do

After launching, tell the user something like:

> I've opened diffx in your browser. Review the changes, leave inline comments on anything you'd like me to fix, then click **"Copy comments"** in the toolbar and paste the result back here.

Keep it brief — don't over-explain the UI.

### 3. Process the pasted comments

The user will paste XML that looks like this:

```xml
<code-review-comments>
<file path="src/utils/parser.ts">
<comment line="42">
<code>+ const x = tokenize(input)</code>
Rename `x` to `parsedToken` for clarity.
</comment>
</file>
</code-review-comments>
```

Each `<comment>` contains:
- `line` — the line number in the diff
- `<code>` — the code line, prefixed with `+` (added) or `-` (deleted)
- The comment body — what the user wants changed

Go through each comment and apply the requested changes to the actual files. The `<code>` block and file path tell you exactly where to look. Read the file, find the relevant code, and make the edit.

If a comment is ambiguous, ask for clarification rather than guessing. If multiple comments interact (e.g., a rename that affects several places), handle them together.

After applying all changes, give a brief summary of what you did.
