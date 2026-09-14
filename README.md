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
lowercased. Files without valid front matter are skipped with a warning rather
than failing the run.

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

Every tool takes a `cwd`, the directory to resolve `tatr.config.yaml` from, so
one server answers for whatever repo the agent is working in. Without it the
server's own working directory is used. There is no tool for changing a task
yet: writing front matter back needs a yaml serializer that does not exist.

## Layout

```
apps/cli/    the tatr command
  src/lib/   parser combinators backing the query and order languages
  src/lsp/   the language server
  src/mcp/   the mcp server
tasks/       the tasks themselves
```
