---
name: diffx-finish-review
description: "Finish a code review session by fetching comments from the running diffx server, applying requested changes, and marking comments as resolved. Use when the user invokes /diffx-finish-review."
user_invocable: true
---

# Finish diffx Review

Fetch all review comments from the running diffx server, apply the requested changes, and mark each one resolved.

This skill uses the session-aware `diffx` subcommands (state, comments, reply, resolve). They auto-discover the server's port via the state file diffx writes at startup — no `lsof`, no hardcoded ports, no curl.

> If a subcommand errors with "no running diffx server found for this session," the user hasn't run `/diffx-start-review` yet (or diffx crashed and cleaned up its state file). Tell them and stop.

## What to do

### 1. List open comments

```bash
diffx comments open
```

Returns a JSON array. Each comment looks like:

```json
{
  "id": "uuid",
  "filePath": "src/utils/parser.ts",
  "side": "additions",
  "lineNumber": 42,
  "lineContent": "const x = tokenize(input)",
  "body": "Rename x to parsedToken for clarity",
  "status": "open",
  "createdAt": 1234567890,
  "replies": []
}
```

If the array is empty, tell the user there's nothing to process and stop.

The `side` field tells you whether the comment is on an added line (`additions`) or a deleted line (`deletions`).

### 2. Process each open comment

For each, decide whether it's a **change request** or a **question**.

#### Change requests (e.g., "Rename x to parsedToken", "Extract this into a helper")

1. Read the file at `filePath`.
2. Find the relevant code using `lineContent` as context.
3. Apply the change described in `body`.
4. Reply explaining what you did, then resolve:

```bash
diffx reply <id> "Done. Renamed x to parsedToken."
diffx resolve <id>
```

#### Questions (e.g., "Why not use a Map here?", "Is this thread-safe?")

Reply with an answer. Do **not** modify code or resolve the comment — leave it open for the user to read and follow up.

```bash
diffx reply <id> "A Map would work too, but we use a plain object here because..."
```

### 3. Handle edge cases

- If a comment is ambiguous, reply asking for clarification rather than guessing.
- If multiple comments interact (e.g., a rename affecting several places), handle them together — apply all edits, then reply+resolve each one.
- The `reply` text is one shell argument; quote it. Multi-line replies: use `$'...\n...'` or a heredoc-via-printf if needed.

### 4. Summary

After processing all comments, give a brief summary: how many changes applied, how many questions answered, how many left open.

## Tips for invocation

- Prefer the subcommands over raw `curl` — they handle port discovery, error messages, and stay resilient if the API evolves.
- If you need raw JSON for other tooling, `diffx state` prints `{port, url, pid, cwd, ...}` and you can curl from there.
- The state file lives at `$CLAUDE_TMPDIR/diffx-state.json` for Claude Code sessions; falls back to `~/.diffx/state-<sha1(cwd)>.json` for plain shells. Override with `$DIFFX_STATE_FILE`.
