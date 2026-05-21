---
"diffx-cli": minor
---

Session-aware CLI subcommands (`diffx state`, `comments`, `reply`, `resolve`, `reopen`, `watch`, `wait-for-submit`) let an attached agent process review comments as they arrive. The browser UI gains a "Done reviewing" Submit button that fires a one-shot SSE pulse to any waiting watcher. The `/diffx-start-review` + `/diffx-finish-review` skill pair is replaced by a single streaming `/diffx-review` skill.
