---
title: "Close command, mark a task as closed"
priority: 50
closed: true
tags: cli, mcp
---

Follow up on [DAENP4NGZQGMP], which left "mark as completed (require yaml
serialize)" out of the first MCP pass.

# Goal

`tatr close <id>` sets `closed: true` in a task's front matter, and the same
operation is exposed as an MCP tool so agents can finish what they start.

# Why it needs a yaml writer

Front matter is only ever read today. `fromYamlStringTransform` in
`apps/cli/src/lib/schema.ts` forbids encoding ("Yaml encoding is not supported,
yet"), so `TaskInfo` is decode only. Closing means writing the front matter
back, which needs an encode side.

Two ways to go:

- Serialize the whole `TaskInfo` and rewrite the front matter block. Clean, but
  reorders keys and drops comments and formatting the user wrote by hand.
- Patch the `closed:` line in place, appending it when missing. Keeps the file
  as authored, and only touches the one field.

Prefer the in place patch for this command, and keep a real encoder as the
later, wider change.

# Scope

- `apps/cli/src/commands/close-task.ts`, wired into `apps/cli/src/index.ts`,
  resolving ids the same way `show-task` does
- A close tool in `apps/cli/src/mcp/tools.ts`
- Closing an already closed task is a no op, not an error
- Consider `--open` (or a separate reopen) to flip it back, the write path is
  the same
- Tests in `apps/cli/src/services/_test`, covering front matter with and without
  an existing `closed` key
