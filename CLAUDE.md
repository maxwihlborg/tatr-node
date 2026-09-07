# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All work happens in `apps/cli` (the `apps/nvim` package is Lua, no build).
Run these from the repo root — `--filter` targets the package, so there is no
reason to `cd`:

```sh
pnpm --filter @tatr/cli build              # tsc && rolldown -> apps/cli/dist/index.js
pnpm --filter @tatr/cli lint               # oxlint, fails the build on unused imports
pnpm --filter @tatr/cli format             # oxfmt
pnpm --filter @tatr/cli exec tsc --noEmit -p .   # typecheck alone, faster than build
pnpm --filter @tatr/cli exec vitest run    # tests (there is no `test` script)
pnpm --filter @tatr/cli exec vitest run -t "mints ids"   # one test by name
```

Stay in the working directory you were given. Paths in the conversation are
written relative to the repo root, so once you have moved, every path either
side mentions has to be translated — extra work for no gain, since `--filter`
and absolute paths already reach anything in the repo. The exception is
exercising the cli itself, which reads the `tatr.config.yaml` of the directory
it runs in.

The global `tatr` on `$PATH` is linked to `apps/cli/bin/tatr.js`, which imports
`dist/index.js` — **run `build` before exercising a change through the `tatr`
command**, or you are testing the previous bundle. To try a change end to end,
make a scratch repo (a dir with `tatr.config.yaml` naming a `taskDir` and that
dir created) and run `tatr` from inside it; `tatr mcp` speaks MCP over stdio and
needs a client driving it, not a pipe of newline-delimited requests.

## Effect

Everything is [Effect](https://effect.website) v4 beta (`4.0.0-beta.107`, pinned
through the pnpm catalog), including the parts still under `effect/unstable`:
`cli` for commands and flags, `ai` for the MCP server and toolkits, `rpc` for
the language server, `process` for spawning fzf. v4 APIs differ from the v3 ones
in most published examples — read the installed `.d.ts` in
`node_modules/.pnpm/effect@*/node_modules/effect/src` rather than guessing, and
prefer `Struct.evolve`, `Option`, and the point-free forms already in use.

Services are `Context.Service` classes with a static `layer`, re-exported from
`src/services/index.ts`. Each command builds its own layer stack and attaches it
with `Command.provide`; `ConfigService` is usually `provideMerge`d because
handlers need it in context too.

## Architecture

A task is a markdown file in the task dir named after its id, with YAML front
matter. `TaskInfo` in `src/schema.ts` (title, priority, tags, closed) is the
whole data model — there is no database and no index.

**Front matter is parsed but barely written.** Effect's
`effect/unstable/encoding` ships `Yaml.parse` and no serializer (same for its
`Toml` and `Ini`), which is why `lib/schema.ts` declares yaml encoding
forbidden. Writes go through `TaskInfo.formatYaml`, which re-emits the four
known fields by hand. Consequences worth knowing: any front matter key outside
the schema is silently dropped when a task is rewritten, and `closed: false` is
written as the absence of the key.

**Reading has three entry points** on `AppService`, deliberately distinct:
`readTask` (streams front matter only, plus `stat`, for listing),
`parseFullTask` (front matter and body, echoed back verbatim — the trim lives at
the display sites), and `parseTask` (from text a caller already holds, for
editor buffers fresher than the file). A task whose front matter does not decode
is logged and skipped, never fatal, so one bad file cannot break `ls`.

**One query engine serves every front end.** `services/query.ts` parses the
query DSL with the parser combinators in `lib/parser.ts`, type checks the `Expr`
AST (`services/expr.ts`), and flattens it to a list of `Expr.Op` in reverse
polish order; `Query.filter` is a small stack machine over that list. The MCP
`list_tasks` tool does not reimplement filtering — `ListTasksParams.compile`
emits the same ops from its structured parameters. Adding a filterable field
means touching `Expr.Op`, the parser, and the stack machine together.

**The LSP** (`src/lsp/`) is an `RpcGroup` whose method names are the LSP ones,
over a hand-rolled `Content-Length` framing in `serialization.ts`. Its point is
markers: `TODO:`/`FIXME:`/`FEAT:` in source comments (`marker.ts`) become tasks
through a code action, which mints an id and writes `[ID]` back into the
comment, after which hover, definition, references, and completion resolve those
ids against the task dir.

**The MCP server** (`src/mcp/`) assembles a `Toolkit` and its handler layer;
every tool takes a `cwd` so one server answers for whatever repo the agent is
in. Logging is pinned to stderr because the protocol owns stdout.

**Errors** are tagged errors that bubble to the single `Effect.catch` in
`src/index.ts`, which maps `_tag` to a message and sets exit code 1. A new
failure type needs a case there or it dies as a defect.

**Ids** (`services/mint.ts`) are Crockford base32 over 4 bytes of big-endian
epoch seconds plus 4 random bytes, so sorting ids lexicographically sorts by
creation time. Decoding is lenient about case and the `O`/`I`/`L` aliases.

## Conventions

This repo tracks its own work with `tatr`: tasks live in `tasks/`, and commits
name the task they came from — `feat(DAEYZH8SPNQ62): close cli and mcp
commands`. Check `tatr ls` before starting, and `tatr close <id>` when done.

Comments are sparse and explain why a choice was made, not what the line does —
match that density rather than annotating new code heavily.
