---
"diffx-cli": minor
---

Expandable context — each file card now lets you expand unedited lines above, below, and between hunks once both file versions have loaded. Contents are fetched lazily as the file scrolls into view (200px rootMargin) via a new ref-aware `/api/file-text?path&ref` endpoint; `/api/diff` exposes the resolved `baseRef`/`headRef` so expansion works with arbitrary `git diff` argument shapes (`HEAD~N`, `X..Y`, `X...Y`, `X Y`, `--staged`). Files larger than 5 MB show a "Load anyway" opt-in instead of streaming the bytes by default.
