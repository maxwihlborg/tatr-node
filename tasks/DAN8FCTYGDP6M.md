---
title: Address tasks by the shortest unique suffix of their id
priority: 40
tags: cli
closed: true
---

Let a task be named by the shortest suffix of its id that no other task shares,
so `tatr show pg` reaches `DAM5X5AZMNQPG`.

Suffix, not prefix. jj shortens prefixes because change ids are uniform noise;
ours are not — `mint.ts` writes 4 bytes of big-endian epoch seconds first, so
every task minted in the same week shares its leading characters. The entropy
lives in the trailing 4 random bytes, and that is the only end worth comparing.

## Resolving

`config.getTaskFilePath` is the single id -> path hop (`show`, `close`, `tag`
all reach it), so resolution lands in one place. Keep an exact full-id fast path
that skips the directory read and can never go ambiguous; only fall back to the
scan for anything shorter. Filenames carry the ids, so the scan is a readdir
with no parse.

The abbreviation must be unique against every file in the task dir, closed ones
included, or closing a task silently re-points an abbreviation at a different
task. An ambiguous input fails with the candidates and their titles, exit 1.

`TemporalId.decode` is already lenient about case and the `O`/`I`/`L` aliases.
Fold both sides through the same normalisation before comparing, or the short
form and the full form will disagree about `0` and `O`.

## Computing

`effect/Trie` is a persistent prefix trie — insert ids reversed and
`keysWithPrefix(reversed(input))` gives the candidate set directly, which is the
lookup half for free. Worth weighing against the flat version: sort the reversed
ids, and each one's shortest unique suffix is one character past the longer of
its common prefix with its two neighbours. That is a sort and a single pass, no
structure to carry. Take the trie if display and lookup end up wanting the same
object; otherwise the sort is less code.

## Display

Print the whole id and highlight the disambiguating tail, the way jj bolds the
short prefix and dims the rest, rather than replacing the id with the suffix.
Truncating costs the property the id was built for — sorting ids
lexicographically sorts by creation time — and a bare `PG` cannot be grepped
back to a file.

Abbreviations lengthen as tasks arrive, so they are for typing and never for
writing down: commit subjects and the `[ID]` markers the LSP code action writes
into source comments stay full ids. Say so in the docs.

## Sizing

Two base32 characters is 1024 buckets, so collisions start around 40 tasks;
three holds a few hundred. Expect two or three, occasionally four.
