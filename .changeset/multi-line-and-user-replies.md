---
"diffx-cli": minor
---

Multi-line range comments — drag the gutter `+` across several lines to comment on a span instead of a single row. Range comments persist as `lineNumber..endLine` and the copy-comments XML now carries an `endLine` attribute (root bumped to `version="2"`, content is XML-escaped). User replies from the browser — every comment bubble has a Reply button; user replies are tagged `author: 'user'` and auto-reopen the comment if it had been resolved. The CLI's launch output now says explicitly that diffx is *waiting* for inline comments, and the wire event for replies carries `commentStatus` so a watching agent doesn't need to re-fetch to learn about auto-reopens.
