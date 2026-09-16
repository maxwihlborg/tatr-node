---
title: Open a task in $EDITOR
priority: 40
tags: cli
closed: true
---

`tatr open pg` drops into the editor on that task's file, which today is
`$EDITOR (tatr show pg -f filepath)` spelled out by hand every time.

Resolution is `AppService.resolveTaskIn`, the same hop `show` and `close` take,
so an abbreviation opens and an ambiguous one reports its candidates rather than
opening the wrong file.

## Which editor

`$VISUAL` before `$EDITOR`, the order everything else uses, and nothing else.
Which editor someone uses is theirs, not the repo's, so it has no business in
`tatr.config.yaml` next to `taskDir` and `formatter`, which are the same for
everyone who clones. With neither set, say so and exit 1; guessing at `vi` is
worse than being told nothing is configured.

The value is a command line, not a program: `code -w` and `nvim +Task` both have
to work, so split it the way git does rather than passing it to a shell.

## Spawning

`effect/unstable/process`, as `fzf.ts` does, but with all three streams
inherited — an editor owns the terminal, and the piped stdout `fzf` wants would
leave a full screen editor drawing into a buffer. Wait for the exit, and carry a
non-zero status through rather than reporting success for an editor that failed
to start.

## new --open

`new --open`, `-o`, opens what it just minted, which is the other half of the
same want — nothing on `new` takes `-o` today, and `ls` spelling it `--order` is
a different command's argument list. It runs after the file is written and
formatted, so what `--format` prints is unchanged and the nvim plugin reading
that output stays as it is.

## Worth deciding

- Whether `open` takes a query instead of an id and opens every match, the way
  `tag` rewrites everything a query matches. Probably not — an editor with forty
  buffers is not what anyone asked for.
- Nothing for the LSP or MCP here. The plugin opens files itself, and an agent
  has no terminal to hand over.
