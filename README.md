# tatr

[![npm](https://img.shields.io/npm/v/tatr-node?label=npm)](https://www.npmjs.com/package/tatr-node)
[![node](https://img.shields.io/node/v/tatr-node?label=node)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/tatr-node?label=license)](./LICENSE)

A command line task tracker that reads its tasks from markdown files.

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

`title` is required; `priority` defaults to `50` and `tags` to none. Tags may be
written as a comma separated string or a YAML list, and are trimmed and
lowercased. A file whose front matter does not decode is listed at priority
`999` as `!! BROKEN, MISSING FRONTMATTER !!` or `!! BROKEN, INVALID FRONTMATTER
!!`, so it sorts to the top of `tatr ls` instead of failing the run or going
unnoticed on stderr. Reading that one by id still reports what is actually wrong
with it.

## Install

```
pnpm add -g tatr-node
tatr init
```

`tatr init` writes a `tatr.config.yaml` at the repo root and creates the task
dir. Every other command walks up from the cwd to find that file, so it works
from anywhere inside the repo.

## Ids

A task is named by its id, which is Crockford base32 over four bytes of epoch
seconds and four random ones. Sorting ids sorts by creation time, and decoding
is lenient about case and the `O`/`I`/`L` aliases.

Because the time comes first, tasks made around each other share their leading
characters, so anything taking an id takes any **suffix** long enough to name
one task:

```
tatr show pg
tatr close 611
```

`tatr ls` greys the shared head of each id to show where that suffix starts. The
set an abbreviation has to be unique against is every task in the dir, closed
ones included, and it shifts as tasks arrive — abbreviations are for typing, not
for writing down. An abbreviation naming more than one task lists the
candidates and refuses rather than guessing.

## Listing tasks

`tatr ls` prints the tasks, filtered by an optional query and ordered by
`--order`:

```
tatr ls '.rust and priority lt 40'
tatr ls '!.done & prio < 40'
tatr ls --order='-priority, title'
tatr ls --all
tatr ls --fzf
```

Closed tasks are left out unless you ask: `--all` (`-a`) for everything,
`--status` (`-s`) for `open`, `closed` or `all` specifically. `--fzf` opens an
interactive picker where each keystroke re-runs the query, so the list narrows
live as you type.

## Query language

A query is a boolean expression over a task's tags and priority.

|                    |                                                                                  |
| ------------------ | -------------------------------------------------------------------------------- |
| `.tag`, `:tag`     | true when the task carries that tag                                              |
| `priority`, `prio` | the task's priority, an integer                                                  |
| comparison         | `lt` `gt` `lte` `gte` `eq` (`is`) `neq` (`isnt`), or `<` `>` `<=` `>=` `==` `!=` |
| negation           | `not`, `!`                                                                       |
| conjunction        | `and`, `&&`, `&`                                                                 |
| disjunction        | `or`, `\|\|`, `\|`                                                               |
| grouping           | `( … )`, `[ … ]`                                                                 |

Either column spells the same query: `not .done and priority gt 50` is
`!.done & prio > 50`. The words are there because every one of those symbols
means something to a shell, so an unquoted query would be eaten before tatr saw
it — the fzf picker and neovim's `:Tatr` have no shell in the way, and the
symbols are the shorter option there.

Comparisons bind tightest, then `not`, then `and`, then `or`, so
`not .done and priority gt 50` reads as `(not .done) and (priority gt 50)`.

Expressions are type checked before they run: both sides of a comparison must be
integers, `and`/`or`/`not` take booleans, `eq`/`neq` take two operands of the
same kind, and the query as a whole must be a boolean. A mismatch is reported
against the offending token:

```
Expected 'boolean' expr, got 'int' expr
  ╭─[1:12]
1 │ .hello and 20
  ·            ^
  ╰──
```

One engine answers every front end. The parsed expression is flattened to a list
of ops in reverse polish order and run through a small stack machine, and the
MCP `list_tasks` tool compiles its structured parameters down to the same ops
rather than filtering some other way.

## Making and changing tasks

`tatr new` mints an id, names a file after it, and prints the path:

```
tatr new Fix the thing -t bug -p 20
tatr new Fix the thing --body 'What is wrong with it'
tatr new Fix the thing --stdin < notes.md
tatr new Fix the thing --open
```

`--open` (`-o`) drops into `$VISUAL` or `$EDITOR` on the file once it is written
and formatted. `tatr open <id>` does the same for a task that already exists.

`tatr close <id>` sets `closed: true` in the front matter, and `tatr rm <id>`
unlinks the file — which works even on a task whose front matter is broken,
since that is one of the reasons to be removing it. Both print the title of what
they touched, because a suffix that is unique but wrong is the one way to reach
the wrong task.

```
tatr show pg          # the body, front matter stripped
tatr show pg -f json  # the whole task as one object
tatr mint             # an id for a task that does not exist yet
```

## Rewriting in bulk

`tatr tag` and `tatr untag` rewrite the tags of every task a query matches,
`-t` repeatable:

```
tatr tag -t scope '.cli and prio gte 50'
tatr untag -t scope '.cli and prio lt 50'
```

The query is the one `ls` takes, so running `ls` with it first shows exactly
what is about to be rewritten. Both take `--status` the same way too, and
default to `open` for the same reason. Tags are trimmed and lowercased, a task
already as asked is left alone, and each task that does change prints what it
gained or lost.

`tatr prune` unlinks the task files instead, and takes the query the same way:

```
tatr prune '.cli'
tatr prune -s closed
```

Either half is enough on its own — a query, a `--status` (`-s`), or both — but
with neither it refuses rather than unlinking every open task because an
argument was forgotten. Preview with `ls` first: what that lists is what this
removes, and there is nothing to undo it with but the repo's own history.

## Ordering

`--order` takes a comma separated list of keys, each optionally prefixed with
`-` to reverse it: `title`, `tags`, `id`, `size`, `priority` (`prio`), `mtime`
(`modified`, `mod`), and `btime` (`created`). Pass `--no-sort` to leave the
tasks in directory order.

Without the flag the repo decides, through `order` in its `tatr.config.yaml`,
written either way round:

```yaml
order: -priority, title
order: [-priority, title]
```

That is what the fzf picker, the neovim plugin, and the MCP `list_tasks` tool
list by too, since none of them pass an order of their own. Absent the key the
default is `-priority, title`.

## Configuration

Only `taskDir` is required:

```yaml
taskDir: ./tasks
order: [-priority, title]
formatter: oxfmt
markers:
  TODO:
  FIXME: bug
  FEAT: feature
autoTags:
  apps/cli: cli
  lua: nvim
```

`markers` is what a `TODO:`/`FIXME:` in a source comment becomes: the key is the
word to look for, matched whatever its case, and the value is the tags the task
made from it carries — as a bare tag, a comma separated string, a list, or
nothing at all. Setting the key replaces the three above rather than adding to
them. The LSP code action and the neovim plugin's `:TatrTodo` both go by this
map, so a marker means the same thing wherever it is claimed from.

`autoTags` maps a path prefix to tags a new task gets for having come out of
there, which is the most reliable signal about what a task concerns and is
otherwise thrown away. Prefixes are relative to the config file and stop at a
segment, so `apps/cli` says nothing about `apps/cli-legacy`. Rules accumulate
rather than competing, and they apply once, at creation, unioned with whatever
`-t` gave — a rewrite that re-applied them would fight `tatr tag`, and a task
that outgrew its origin could never stay untagged. Where a task came from is
always explicit: `tatr new --file <path>`, repeatable, and the same list on the
MCP `create_task`. The LSP code action gets it free from the buffer.

`formatter` runs over a task on its way to disk, on every write — `new`, `tag`,
`untag`, `close`, the MCP write tools, and the LSP code action alike. It takes
`oxfmt` or `prettier`, and either way the task comes out formatted the way its
own repo formats markdown: both walk up from the task file for their config,
`.oxfmtrc.json` or `.prettierrc`. oxfmt goes through its cli rather than its js
api, which resolves no config; prettier's `resolveConfig` does that itself, so
it runs in process.

Whichever it is, the package is resolved from the repo the config belongs to, so
the version that formats a task is the one that repo installed. Naming a
formatter the repo does not have is a config error, and the write is refused
rather than landing unformatted.

`tatr config` prints the whole config as json with the defaults filled in, which
is how the neovim plugin reads it. `root` is the task dir resolved against the
config's own location, so a caller can open a task without resolving anything:

```json
{
  "config": { "taskDir": "./tasks", "order": ["-priority", "title"], "markers": {} },
  "root": "/home/you/code/project/tasks"
}
```

## Language server

`tatr lsp` speaks LSP over stdio, and needs no `nvim-lspconfig`:

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

Its point is markers. On a bare `TODO:` or `FIXME:`, `gra` mints a task and
writes the id back into the comment as `TODO(DAM5X5AZMNQPG):`; from then on `K`
shows the task, `grd` jumps to its file, `grr` lists every marker pointing at
it, and completion offers ids inside `[…]` or `(…)`. `root_markers` only tells
neovim where to attach — the server resolves `tatr.config.yaml` per request, so
several projects in one session are fine.

## Neovim

The repo is also a plugin, wrapping the cli in a picker and a few commands. It
shells out to `tatr`, so the cli has to be installed and on `$PATH`:

```lua
{
  "maxwihlborg/tatr-node",
  dependencies = { "nvim-lua/plenary.nvim" },
  cmd = { "Tatr", "TatrNew", "TatrMint", "TatrTodo", "TatrUpsert" },
  opts = {},
}
```

```vim
:Tatr .rust and prio lt 40
:TatrNew Write the docs
:TatrTodo
```

`:Tatr` hands everything after it to `tatr ls` as a query and opens the result
in a picker — fzf-lua when it is installed, `vim.ui.select` otherwise — then
`lcd`s into the task dir on the way in. With fzf-lua, fzf does no matching of
its own: what you type is the query DSL, re-run through the cli on every
keystroke, with `ctrl-g` to cycle open → closed → all, `ctrl-y` to yank an id
and `ctrl-x` to close a task without leaving the list.

`:TatrNew` creates a task and opens it. `:TatrTodo` claims the `TODO:` under
the cursor the way the code action does, `:TatrMint` inserts a bare `[<id>]:`
to be claimed later, and `:TatrUpsert` opens whatever task the id under the
cursor names, creating it first if it is not there yet.

Options go to `require("tatr").setup()`, or per call as
`require("tatr").pick { open = "vsplit" }`: `cmd`, `args`, `cd`, `open`,
`create`, `upsert`, `picker`, `prompt`, and an `fzf` table for the picker's
keys. How the list is ordered belongs to the repo rather than the editor —
set `order` in `tatr.config.yaml` and every front end follows.

## Agents

`tatr show <id> -f agent` prints a task as a tagged block with its path, for
handing to something that reads rather than parses.

`tatr mcp` speaks MCP over stdio, so an agent can reach tasks without shelling
out at all:

```json
{
  "mcpServers": {
    "tatr": { "command": "tatr", "args": ["mcp"] }
  }
}
```

| tool          |                                                                     |
| ------------- | ------------------------------------------------------------------- |
| `list_tasks`  | filtered by `tags`, `minPriority`, `maxPriority`, `status`, `limit` |
| `show_task`   | one task by id, front matter and body, with the files mentioning it |
| `create_task` | `title`, with optional `tags`, `priority`, `body` and `files`       |
| `update_task` | any of `title`, `priority`, `tags`, `body` or `patch`               |
| `close_task`  | one task by id, already closed is answered for as it stands         |

Every tool takes a `cwd`, the directory to resolve `tatr.config.yaml` from, so
one server answers for whatever repo the agent is working in. Without it the
server's own working directory is used.

Everything but `list_tasks` answers with the whole task, body included. A
listing leaves bodies out because it returns many; a write hands one back
because the formatter rewrites what was sent, and the text that landed is what
the next patch has to anchor against.

`update_task` takes either a whole `body` or a `patch`, which edits the one
already there: `replace`, `insert_before`, `insert_after`, `prepend`, `append`
and `replace_range`, applied in order and atomically, each anchored on text that
has to match exactly once. Whitespace in an anchor is elastic, so a run of it
matches a run of any length and an anchor still lands after the formatter has
rewrapped the paragraph it came from.

Ids are resolved the way the cli resolves them, abbreviations included, and an
ambiguous one is a question rather than a failure: the server asks through MCP
elicitation which task was meant. A client that cannot be asked, or an operator
who declines, gets the candidates and their titles back in the error instead.

## Prior art

tatr began as a node take on [Tsoding's tatr](https://github.com/tsoding/tatr)
and keeps its central bet: that a task is a file in your repo, so the tracker
inherits branching, history and `git blame` for free, and priority is there for
sorting rather than for ceremony. The comparison words — `lt`, `gte` and the
rest — are his answer to `<` and `>` meaning something else to a shell, and they
are kept here so a query reads the same in both. So are TQL's `:tag` and
`[ … ]`, alongside this one's own `.tag` and `( … )`.

It has since gone its own way. A task is one markdown file with YAML front
matter rather than a directory holding a `TASK.md` with markdown bullets for
metadata, and ids are time sortable Crockford base32 rather than human readable
`YYYYMMDD-HHMMSS` stamps. The rest — the LSP, the MCP server, the fzf picker,
the neovim plugin, `autoTags` — has no counterpart upstream. The two are not
file compatible, and this one runs wherever node does.

## License

MIT, see [LICENSE](./LICENSE).
