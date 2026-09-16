---
title: Patch a task body by anchor rather than replacing it
priority: 45
tags: cli, mcp
closed: true
---

`update_task` replaces the whole body, and `append_task` adds to the end.
Between them sits everything an agent actually does to a task it is part way
through: correct a sentence, insert a paragraph under a heading, cut a section
that stopped being true. Today all three mean re-sending the body, which costs
tokens and loses content — models drop things when re-emitting long prose.

Linear's `save_issue` has the answer, and it is worth copying almost verbatim: a
`patch` array of anchored edits, taken **in place of** the full body rather than
alongside it. All six of its ops:

| op              |                                                    |
| --------------- | -------------------------------------------------- |
| `replace`       | `old_string`, `new_string`, optional `replace_all` |
| `insert_before` | `anchor`, `text`                                   |
| `insert_after`  | `anchor`, `text`                                   |
| `prepend`       | `text`                                             |
| `append`        | `text`                                             |
| `replace_range` | `from`, `to` exclusive, `new_string`               |

Three properties carry the design, and none of them are optional:

- **Every anchor matches exactly once.** Not the first match — the only one. A
  `replace_all` opts out for the case where every occurrence is meant.
- **In order, and atomically.** Ops see what the ops before them left behind,
  and one failure aborts the whole save rather than landing half of it.
- **Anchors are content, never positions.** This is what the original task ruled
  offsets and diffs out for, and an anchor survives what a byte offset does not.

## Why it works here

The formatter reflows on every write, which is what made positions unusable. It
does not touch anchors: the ops apply in order to the body held in memory, oxfmt
runs once over the result, and nothing intermediate reaches disk. What an agent
anchors against is what `show_task` gave it, which is the formatted text already
on disk, so the two agree.

`replace_range` is the one to get right. Notion's equivalent asks for the first
ten characters, an ellipsis, and the last ten, and that fuzziness is the reason
they are deprecating it; two exact anchors with `to` exclusive says the same
thing without the guessing.

## Scope

**`append_task` goes.** The `append` op does the same thing, and one obvious way
to write to a task beats two. Its description already points at `update_task`,
so the reverse pointer is all that is left to write.

Cap the array — Linear stops at 50, and there is no reason to be more generous.

Do not copy the consolidation. Linear folds create and update into one
`save_issue` keyed on whether `id` is there; the tools here stay split, and a
discriminated union across a whole tool's parameters is the shape that breaks
strict clients.

## Failing well

An anchor that misses is the normal failure, not an exception, so the message
has to be usable without a second round trip: which op, by index, and whether it
matched nothing or matched more than once. `AppService.updateTask` already takes
the whole task and hands back `{ info, body }`, so the ops themselves are a pure
function over the body and belong beside it, testable without a repo.

## Matching across a reflow

`proseWrap` is the thing that makes anchors interesting. The body on disk is
wrapped, `show_task` hands it back verbatim, so an agent quoting a sentence that
spans a line break has to reproduce the newline in exactly the right place — and
models normalise a wrapped sentence back onto one line when they quote it. The
anchor is then semantically right and matches nothing. Exactly-once turns that
into a clean failure rather than a wrong edit, which is the good outcome, but it
will happen often enough to matter.

So whitespace is elastic when matching: a run of it in the anchor matches a run
of any length in the body, newlines included. That covers the reflow in both
directions, since a paragraph break is just whitespace, and it is what lets
`replace_range` span paragraphs.

**A linear scan, not a regex.** Walk the body and the anchor together from each
candidate start: both cursors on whitespace skips both runs, otherwise the
characters have to be equal, and an exhausted anchor is a hit. It hands back
real indices into the untouched body, so there is nothing to map back, and
nothing to escape — turning arbitrary prose into a pattern is a silent
correctness bug where this is a loud one. Task bodies are kilobytes, so the
quadratic worst case never arrives; `lib/parser.ts` is already the precedent for
writing the matcher rather than reaching for `RegExp`.

Elastic whitespace weakens exactly-once a little, since two passages differing
only in spacing now collide. In prose that is not a real case.

Two consequences worth writing into the tool description. `replace_range` is the
op for anything large, precisely because `from` and `to` are short and each
likely to sit inside one line, where a single long `old_string` is guaranteed to
cross several. And `insert_after` lands after the last non-whitespace character
the anchor matched, not after whatever trailing run the scan consumed.

Headings, list markers, table rows and fenced code keep their line structure
through a format, so anchors there are stable regardless. It is prose paragraph
interiors that move, which is also where the long anchors are.
