---
title: "Cycle status in the fzf picker"
priority: 50
tags: nvim
closed: true
---

`ctrl-g` cycles `open` -> `closed` -> `all`, re-invoking the picker with `reuse`
so the window and the typed query survive. The current one shows bracketed in
the action hint line fzf-lua builds, `:: <ctrl-g> to [open] - closed - all`, via
a `header` function on the action.

Also makes `:Tatr` prefer the fzf-lua picker when it is installed,
`picker = "select"` to force `vim.ui.select`.
