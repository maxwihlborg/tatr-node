---
title: Global env variables
priority: 50
tags: config
---

`tatr.config.yaml` is repo config, checked in and shared, so a pager has no
place in it — `glow` on one machine is nothing on another. There is nowhere for
a per user preference to live.

Read them from the environment rather than adding a config layer, the way `fzf`
does with `FZF_DEFAULT_OPTS`. `services/editor.ts` already has the shape:
`Config.nonEmptyString` over `$VISUAL` then `$EDITOR`, wrapped in
`Config.option`, spawned with `shell: true` so a command line with flags reaches
its program. A pager is `$TATR_PAGER` then `$PAGER` through the same pipe, and
`Editor.open` is the template — `stdin: "pipe"` with the body written and closed
instead of inherited, stdout and stderr inherited, since `less`, `bat` and
`glow` all open `/dev/tty` for their keys.

The alternative, a `~/.config/tatr/config.yaml` merged under the repo one, buys
precedence rules and a `show-config` that has to say which layer every value
came from, for what is one setting today.

`tatr show` is not only a human command, so paging is gated twice:

- only `format === "body"`
- only when stdout is a TTY

or `tatr show pg -f json | jq` feeds a pager into a pipe. Same reason git pages
`log` and not `rev-parse`.

`ls` is left alone — it is short, and fzf is already the interactive front end.
Were it to page too, the variable belongs in `Printer` rather than at the `show`
handler.

Nothing is blocked meanwhile: `tatr show pg | glow -` works today.
