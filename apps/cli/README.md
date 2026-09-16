# tatr-node

[![npm](https://img.shields.io/npm/v/tatr-node?label=npm)](https://www.npmjs.com/package/tatr-node)
[![node](https://img.shields.io/node/v/tatr-node?label=node)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/tatr-node?label=license)](https://github.com/maxwihlborg/tatr-node/blob/main/LICENSE)

A command line task tracker that reads its tasks from markdown files.

```
pnpm add -g tatr-node
tatr init
```

Tasks live as `.md` files in a `tasks/` directory, each with a YAML front matter
block describing it:

```markdown
---
title: First task
priority: 100
tags: hello, WORLD
---

Some information about this task
```

`title` is required; `priority` defaults to `50` and `tags` to none. `tatr init`
writes a `tatr.config.yaml` at the repo root, and every command walks up from
the cwd to find it.

## A tour

```
tatr new Fix the thing -t bug -p 20   # mint a task, print its path
tatr ls '.bug and priority lt 40'     # filter by tags and priority
tatr ls --all --fzf                   # interactive picker, closed ones too
tatr show pg                          # ids abbreviate to any unique suffix
tatr open pg                          # in $VISUAL or $EDITOR
tatr close pg
tatr rm pg
```

A task is named by a Crockford base32 id over four bytes of epoch seconds and
four random ones, so sorting ids sorts by creation time. The time comes first,
which means tasks made around each other share their leading characters — so
anything taking an id takes any **suffix** long enough to name one task, and
`tatr ls` greys the shared head to show where that suffix starts.

Queries are boolean expressions over tags and priority, spelled either in words
or in symbols — `.bug and priority lt 40` is `.bug & prio < 40`, and `:tag` and
`[ … ]` work too. They are type checked before they run, with a mismatch
reported against the offending token.

## More than a cli

`tatr lsp` turns a `TODO:` or `FIXME:` in a source comment into a task through a
code action, writing the id back into the comment as `TODO(DAM5X5AZMNQPG):` so
hover, go-to-definition and find-references keep the two tied together. It
speaks LSP over stdio and needs no `nvim-lspconfig`:

```lua
vim.lsp.config("tatr", {
  cmd = { "tatr", "lsp" },
  -- markers live in code, so attach wherever you leave them
  filetypes = { "typescript", "javascript", "lua", "rust", "markdown" },
  root_markers = { "tatr.config.yaml" },
  -- references need ripgrep on the machine, so they are off unless asked for
  init_options = { references = true },
})

vim.lsp.enable("tatr")
```

`root_markers` is only how neovim decides where to attach a client; the server
resolves `tatr.config.yaml` per request, walking up from the file the request is
about, so several projects in one session are fine.

`tatr mcp` speaks MCP over stdio, so an agent can list, read, create, update and
close tasks without shelling out — including patching a body in place, anchored
on text rather than on offsets a reformat would invalidate:

```json
{
  "mcpServers": {
    "tatr": { "command": "tatr", "args": ["mcp"] }
  }
}
```

There is a neovim front end too, in
[tatr.nvim](https://github.com/maxwihlborg/tatr-node#neovim).

## Documentation

The query language, the ordering keys, every config key, and the full MCP
toolkit are documented in the
[repository README](https://github.com/maxwihlborg/tatr-node#readme).

## Prior art

tatr began as a node take on [Tsoding's tatr](https://github.com/tsoding/tatr)
and keeps its central bet: a task is a file in your repo, so the tracker
inherits branching, history and `git blame` for free. It has since gone its own
way — one file per task with YAML front matter, time sortable ids, an LSP, an
MCP server — and the two are not file compatible.

## License

MIT, see
[LICENSE](https://github.com/maxwihlborg/tatr-node/blob/main/LICENSE).
