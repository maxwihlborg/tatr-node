# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The `justfile` at the root is the front door, and every recipe fans out over the
workspace through turbo, so these run from the repo root. In practice that means
`apps/cli`, the only package with a build — the neovim plugin is Lua, and sits
at the repo root as `lua/` and `plugin/` because lazy.nvim installs a repo
rather than a directory inside one.

```sh
just build         # tsc && rolldown -> apps/cli/dist/index.js
just test          # vitest
just format        # oxfmt
just pull-request  # format, lint and build — the gate before handing work over
just               # list the recipes, with their one letter aliases
```

Anything narrower goes through pnpm, still from the root — `--filter` targets
the package, so there is no reason to `cd`:

```sh
pnpm exec vitest --run -t "mints ids"            # one test by name
pnpm exec turbo run lint                         # oxlint, fails on unused imports
pnpm --filter tatr-node exec tsc --noEmit -p .   # typecheck alone, faster than build
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

**Front matter goes through the `yaml` package, both ways.** Effect's
`effect/unstable/encoding` ships a `Yaml.parse` that cannot read a scalar folded
across lines and no serializer at all, so `lib/schema.ts` uses `yaml` for both
directions. `TaskInfo` closes over a `Schema.Record` rest, so keys outside the
schema survive a rewrite rather than being dropped. The hand written shape is
kept by `omitDefault` in `lib/schema.ts`: `closed: false` and an empty `tags`
are written as the absence of the key, and tags join with `, ` rather than
becoming a yaml list. Titles are quoted only when yaml requires it.

**Reading has three entry points** on `AppService`, deliberately distinct:
`readTask` (streams front matter only, plus `stat`, for listing),
`parseFullTask` (front matter and body, echoed back verbatim — the trim lives at
the display sites), and `parseTask` (from text a caller already holds, for
editor buffers fresher than the file). A task whose front matter does not decode
reads as the `broken(message)` placeholder in `app-service.ts` — priority `999`,
titled `!! BROKEN, <what is wrong> !!` — so one bad file lists loudly instead of
breaking `ls`. `parseFullTask` still fails on it, which is what `show` and
`close` report, and what stops a bulk rewrite from flattening a file it cannot
parse.

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

Because the time comes first, tasks minted around each other share their leading
characters, so anything taking an id takes any **suffix** long enough to name one
task — `tatr show pg` — and `ls` greys the shared head of each id to show where
that suffix starts (`lib/abbrev.ts`, resolved by `AppService.resolveTaskIn`).
The uniqueness set is every file in the task dir, closed ones included, but it
still shifts as tasks arrive: abbreviations are for typing, never for writing
down. Commit subjects and the `[ID]` markers the LSP writes into source comments
stay full ids.

**An ambiguous id over MCP is a question, not a failure.** `show_task`,
`update_task` and `close_task` resolve the same way the cli does,
and on more than one match ask through `McpServer.elicit`; declining, or a client
that cannot be asked at all, gets the candidates and their titles in the error.
Asking needs `McpServerClient`, which no handler layer can hold because it is a
request back out to whoever is driving the server — each of those four carries
`Tool.addDependency(McpSchema.McpServerClient)` so `McpServer.toolkit` supplies
it per call. Every tool answers with the canonical id whatever was passed in.

## Conventions

This repo tracks its own work with `tatr`: tasks live in `tasks/`, and commits
name the task they came from — `feat(DAEYZH8SPNQ62): close cli and mcp
commands`. Check the tasks before starting, and close the one you finished when
done.

**Reach for the `tatr` MCP tools, not the cli, when the work is a task itself** —
`list_tasks`, `show_task`, `create_task`, `close_task`. They take structured
parameters and a `cwd`, so there is no shell quoting to get wrong and no
temporary file to pipe a body through. The `tatr` on `$PATH` runs the last
build, which may predate the change you are working on; the MCP server is the
same code and is the right front end for reading and writing tasks. Exercise the
cli when the cli is what you are testing.

Comments are sparse and explain why a choice was made, not what the line does —
match that density rather than annotating new code heavily.

**This is a `jj` repo**, colocated with git, so a `.git` is there to be found and
git reads the tree correctly. Never run a git command that writes. Git writing to
the index or moving HEAD behind `jj`'s back leaves the two disagreeing about what
the working copy is, and the operation is outside `jj op log`, so it is not
undoable. Reading is fine — `git status`, `git diff`, `git log`, `git show`.
Everything that changes anything goes through `jj`, or is left for a human to do.

`.claude/settings.json` denies the writing subcommands rather than trusting this
paragraph to be read: `add`, `am`, `apply`, `branch`, `checkout`, `cherry-pick`,
`clean`, `commit`, `filter-branch`, `gc`, `merge`, `mv`, `pull`, `push`,
`rebase`, `reset`, `restore`, `revert`, `rm`, `stash`, `switch`, `tag`,
`update-ref`. A few of those read as well as write — `git branch` with no
arguments only lists — and they are denied anyway, since `jj log` and
`jj bookmark list` answer the same questions. Keep the two lists in step.
