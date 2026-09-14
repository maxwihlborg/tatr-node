# tatr

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

## Listing tasks

`tatr ls` prints the tasks, filtered by an optional query and ordered by
`--order`:

```
tatr ls '.rust and priority lt 40'
tatr ls --order='-priority, title'
tatr ls --fzf
```

`--fzf` opens an interactive picker where each keystroke re-runs the query, so
the list narrows live as you type.

## Query language

A query is a boolean expression over a task's tags and priority.

|                    |                                                                                  |
| ------------------ | -------------------------------------------------------------------------------- |
| `.tag`             | true when the task carries that tag                                              |
| `priority`, `prio` | the task's priority, an integer                                                  |
| comparison         | `lt` `gt` `lte` `gte` `eq` (`is`) `neq` (`isnt`), or `<` `>` `<=` `>=` `==` `!=` |
| negation           | `not`, `!`                                                                       |
| conjunction        | `and`, `&&`, `&`                                                                 |
| disjunction        | `or`, `\|\|`, `\|`                                                               |
| grouping           | `( … )`                                                                          |

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

## Tagging in bulk

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

`tatr init` writes a `tatr.config.yaml`, and every command walks up from the cwd
to find it. Only `taskDir` is required:

```yaml
taskDir: ./tasks
order: [-priority, title]
formatter: oxfmt
markers:
  TODO:
  FIXME: bug
  FEAT: feature
```

`markers` is what a `TODO:`/`FIXME:` in a source comment becomes: the key is the
word to look for, matched whatever its case, and the value is the tags the task
made from it carries — as a bare tag, a comma separated string, a list, or
nothing at all. Setting the key replaces the three above rather than adding to
them. The LSP code action and the neovim plugin's `:TatrTodo` both go by this
map, so a marker means the same thing wherever it is claimed from.

`formatter` runs over a task on its way to disk, on every write — `new`, `tag`,
`untag`, `close`, the MCP `create_task`, and the LSP code action alike. Only
`oxfmt` is implemented, and it goes through oxfmt's cli rather than its js api,
which has no config resolution: the cli walks up from the task file for
`.oxfmtrc.json`, so a task comes out formatted the way its own repo formats
markdown. The oxfmt package is resolved from the repo the config belongs to, so
the version that formats a task is the one that repo installed. Setting the key
in a repo that has no oxfmt is a config error, and the write is refused rather
than landing unformatted.

`tatr config` prints the whole thing as json with the defaults filled in, which
is how the neovim plugin reads it. `root` is the task dir resolved against the
config's own location, so a caller can open a task without resolving anything:

```json
{
  "config": { "taskDir": "./tasks", "order": ["-priority", "title"], "markers": {} },
  "root": "/home/you/code/project/tasks"
}
```

## Agents

`tatr show <id> -f agent` prints a task as a tagged block with its path, and
`-f json` prints the same as one object, for handing to something that reads
rather than parses.

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
| `show_task`   | one task by id, front matter and body                               |
| `create_task` | `title` with optional `tags`, `priority` and `body`                 |
| `close_task`  | one task by id, already closed is answered for as it stands          |

Every tool takes a `cwd`, the directory to resolve `tatr.config.yaml` from, so
one server answers for whatever repo the agent is working in. Without it the
server's own working directory is used.

## Layout

```
apps/cli/    the tatr command
  src/lib/   parser combinators backing the query and order languages
  src/lsp/   the language server
  src/mcp/   the mcp server
tasks/       the tasks themselves
```
