---
title: Mcp tools for changing a task
priority: 55
tags: mcp, cli
closed: true
---

The toolkit is `list_tasks`, `show_task`, `create_task`, `close_task`. Once a
task exists an agent can only close it — refining a title, a priority, the tags
or the body means editing the file behind tatr's back.

`update_task` with `id`, `cwd`, and optional `title`, `priority`, `tags`,
`body`, where an absent field means unchanged.

Most of the write path is already there. `updateTaskInfo(context, file, update)`
rewrites front matter and keeps the body verbatim, which covers everything but
the body. Generalising it to take the whole task rather than its info, with
`updateTaskInfo` left as a thin wrapper, is the one change needed underneath.

Watch the body shape when replacing it: `parseFullTask` hands back a body that
starts with the blank line after the closing `---`, so a replacement wants to be
`"\n" + text.trim() + "\n"` or the file comes out differently to what
`create_task` writes.

An append alongside it, because that is what writing to a task actually looks
like: a measurement, what landed, a correction at the end. Replacing the whole
body to add a paragraph makes the agent re-emit text it is not changing, which
costs tokens and loses content — models drop things when re-emitting long prose.

Not offsets or diffs. The formatter reflows paragraphs on every write, so byte
positions and multi line anchors taken from an earlier `show_task` stop matching
in ways the caller cannot predict. An agent that can reach the filesystem can
edit the markdown directly anyway; the toolkit is for the ones that cannot, and
those are the least able to reason about positions in a file they never see.

Two things already settled:

- `tags` replaces wholesale. The cli keeps `tag` and `untag` as separate verbs
  because they take a query, but an agent holds one id and can read the current
  tags out of `show_task`, so replacing is enough and one fewer tool.
- `closed` stays out of it. Closing is one way through the tooling on purpose —
  nothing but deleting the key by hand reopens a task, and `update_task` should
  not be the thing that changes that.
