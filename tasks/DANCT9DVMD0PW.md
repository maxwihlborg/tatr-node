---
title: Let dprint be the formatter too
priority: 30
tags: cli
closed: true
---

`formatter` takes `oxfmt` and `prettier`. dprint is the third thing a repo
formats its markdown with, and `Formatter.run` is a switch now, so it is one
more case.

It goes the oxfmt way rather than the prettier way: a subprocess over stdin.
`@dprint/formatter` is a wasm host that takes config as an argument and resolves
none of it, so the cli is again the only thing that walks up for `dprint.json`.

## Reaching the binary

Not `require.resolve("dprint")` — the npm package declares no `main` and no
`exports`, only `bin: "bin.cjs"`, so resolving it as a module throws. Resolve
`dprint/package.json` instead and take its directory, or resolve
`dprint/bin.cjs` directly; `requireFrom(context)` already hands over a `require`
bound to the repo.

`bin.cjs` is a node shim that execs the native binary sitting beside it, picking
`dprint.exe` on windows. Spawning the shim through `process.execPath` costs one
extra node process and is exactly what `runOxfmt` already does with oxfmt's
`cli.js`, so the spawn, the stdin stream and the care about draining stdout
before waiting on the exit code all carry over unchanged. The command is:

```
dprint fmt --stdin <file>
```

A full path is what makes dprint apply the config's own includes and excludes,
which is what we want to pass.

## Two things that are not like the others

**Plugins are wasm fetched over the network.** A `dprint.json` names them by
url, `https://plugins.dprint.dev/markdown-0.19.0.wasm`, and the first format in
a cold cache downloads and compiles one. Checked: that progress goes to stderr,
so stdout stays clean and `runOxfmt`'s "read stdout, then take the exit code"
shape holds. Worth saying in the docs that the first write in a fresh checkout
wants network, and that a repo with no markdown plugin configured formats
nothing.

**`lineWidth` alone does not wrap.** The markdown plugin defaults `textWrap` to
`maintain`, so a repo has to ask for `"textWrap": "always"` before prose is
reflowed at all. Nothing for us to do, but it is the first thing to look at when
someone reports that dprint left their task alone.

## Failing the same way

A missing `dprint`, a config it rejects, a non-zero exit: all through
`invalid(context, ...)` to the same `ConfigError`, and the task is not written.
