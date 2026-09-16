---
title: Read and write Tsoding's tatr layout
priority: 25
tags: cli
---

The query language already reads his: `:tag` and `[ … ]` parse here. The files
do not. A repo tracked with [Tsoding's tatr](https://github.com/tsoding/tatr) is
a directory per task rather than a file, an id that is a timestamp rather than
base32, and metadata in markdown bullets rather than yaml.

|              | his                                                   | ours                                               |
| ------------ | ----------------------------------------------------- | -------------------------------------------------- |
| a task is    | `tasks/<HUID>/TASK.md`, attachments beside it         | `tasks/<id>.md`                                    |
| the id       | `YYYYMMDD-HHMMSS` utc, `-rexim` or `-01` when taken   | Crockford base32, epoch seconds and 4 random bytes |
| the metadata | `# title`, then `- STATUS:`, `- PRIORITY:`, `- TAGS:` | yaml front matter                                  |
| closed is    | `STATUS: CLOSED`                                      | `closed: true`, absent when open                   |

## The fork to settle first

**Interop or import.** A compatibility layer reads and writes his repos in
place, and every write path has to know which shape it is in forever. An import
is one command that walks a directory of his and mints ours, and is perhaps a
tenth of the code. If nobody actually wants to keep a repo readable by both
tools, the second is the honest answer and the rest of this task is moot.

Settled either way: one config key, `layout`, taking `tsoding`. Not separate
`idFormat`, `nesting` and `metadata` switches: it is his format, not a menu, and
three orthogonal flags is eight combinations nobody has.

## What it reaches

The layout is the invasive half, because a file path is assumed everywhere:
`taskFilePathIn` joins `<id>.md`, `taskIdOf` is a basename, `globPattern` is
`*.md`, and `resolveTaskIn` reads that glob for its uniqueness set. All of that
becomes `<id>/TASK.md` and `*/TASK.md`. `rm` stops unlinking a file and starts
removing a directory, which is a different kind of destructive now that
attachments can sit in it.

The metadata is a second parser and a second serializer. `extractFrontMatter`
and `parseFullTask` both look for `---` fences, and `lib/schema.ts` writes them;
his wants the `# title` heading read as the title, the bullets after it as the
fields, and everything below that as the body. `broken()` still has to catch a
file that decodes as neither.

Ids reach `mint.ts` and `lib/abbrev.ts`. HUIDs are time first like ours, so
suffix abbreviation keeps working and `ls` still greys a shared head. But
`normalizeCrock32` is the wrong fold for a string of digits and hyphens, and his
collision story is a `-01` suffix on the assumption that no human mints twice in
one second — which an agent calling `create_task` in a loop breaks immediately.
Minting under `layout: tsoding` has to check the dir and count up.

The LSP, the markers, `autoTags` and the query engine need nothing: they all go
through `AppService` and never learn where a task lives.
