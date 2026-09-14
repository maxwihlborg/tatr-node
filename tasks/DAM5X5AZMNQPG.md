---
title: Auto tag new tasks by where they came from
priority: 45
tags: cli, config, lsp, mcp
---

Which part of the tree you were looking at is the most reliable signal about
what a task concerns, and it is thrown away today. The lsp code action already
holds the file uri and uses it only to find the task dir.

An `autoTags` map in the config, path to tags:

```yaml
autoTags:
  apps/cli: cli
  apps/nvim: nvim, lsp
  packages/core: core
```

Matching, in the shape the rest of the config already works:

- Prefixes, not globs. `fast-glob` is a globber and exports no matcher, and a
  prefix covers "a task made from the cli folder is a cli task" without pulling
  in picomatch.
- Relative to the config file, never the cwd — the lsp and the mcp server answer
  for a repo they are not standing in.
- Rules accumulate. `apps/cli` and `apps` both firing is a union, so there is no
  specificity order to reason about.
- On creation only. A rewrite that re-applied them would fight `tatr tag`, and a
  task that outgrew its origin would never stay untagged.
- Unioned with whatever `-t` already gave.

Three callers have to say where they are:

- The lsp code action gets it free, it already has the uri.
- `tatr new --file <path>`, which is how `:TatrNew` passes the buffer.
- `create_task` over mcp needs a `file` parameter. Without it an agent editing a
  file silently misses the tags, since `cwd` is the repo rather than the file.

The fork worth deciding first is explicit `--file` against deriving it from the
cwd. Implicit needs no flag and no plugin change, but then `tatr new` from a
subdirectory tags differently than from the root with nothing on screen saying
why. Explicit, with implicit left as a config switch if it turns out to be
wanted.

A rename is the one thing to handle. The tags already written stay true — a task
tagged `cli` was about the cli and still is, wherever the directory moved to —
but the rule stops matching, nothing errors, and new tasks quietly come out
untagged until someone notices the pattern. The config is one line to fix; the
cost is the delay before anyone sees it. Worth checking each rule's path exists,
either on read or in what `tatr config` prints, so a dead rule is visible rather
than silent. If the rename also changes what the thing is called, `tatr tag` and
`tatr untag` over a query are the two commands that retag the history.
