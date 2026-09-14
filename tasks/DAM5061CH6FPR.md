---
title: Resident lister for the picker
priority: 20
tags: cli, nvim
---

The picker pays a whole process per keystroke: `ls --fzf` and the fzf-lua picker
re-run `tatr ls` behind a 150ms debounce, and each run costs ~82ms of which
~40ms is node and effect starting before a single task is read. Splitting the
bundle (DAM491VAW14FW) took 12ms off that and changed nothing anyone can feel,
because the cost is the process, not the parse.

A resident lister would make it a socket round trip instead. fzf can already
take the other half: `--listen=SOCKET_PATH` (0.74 here) starts an http server on
a unix socket that accepts actions, so something long lived can push a new list
in without spawning anything.

`tatr lsp` is already a long lived process that reads the task dir and answers
questions about it, so this may be a method on that rather than a second daemon.

Open questions, roughly in the order they should be answered:

- What does the picker actually cost today, measured in the editor rather than
  assumed. If the 150ms debounce already hides it, stop here.
- Getting the query back out per keystroke. `--bind change:execute-silent(...)`
  still spawns something; the question is whether it can be a cheap one that
  talks to the socket, or whether fzf's http server can be read from instead.
- Who starts it, who stops it, and what a stale one does. A daemon that outlives
  the repo it was started in is worse than 80ms.
- Whether any of this survives fzf-lua, which drives its own picker.

Only worth it if the picker actually annoys someone.
