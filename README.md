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
(`modified`, `mod`), and `btime` (`created`). The default is
`-priority, title`. Pass `--no-sort` to leave the tasks in directory order.

## Layout

```
apps/cli/    the tatr command
  src/lib/   parser combinators backing the query and order languages
tasks/       the tasks themselves
```
