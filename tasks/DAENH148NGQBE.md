---
title: Support references
priority: 50
tags: feature, lsp
closed: true
---

Support goto reference in `lsp`

- If in a task file show and not on an id show all the references for that
  "file"
- Limit only work with persisted files (use `ripgrep` or something `.gitignore`
  aware)

# Notes

Persisted only is the decision, not a shortcut to undo later. Reading through to
the client's copy would mean subtracting the disk hits of every modified buffer,
or the same marker shows up twice, deleted ones keep showing, and edits above
one put its line number out. Completion joins pending tasks because it needs ids
that are not written yet ([DAENFNKM05E1C]); references answer what the repo
holds, and need exact positions to jump to.
