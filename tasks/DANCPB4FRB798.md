---
title: Let prettier be the formatter too
priority: 35
tags: cli
closed: true
---

`formatter` takes one value, `oxfmt`, and most repos that format their markdown
at all format it with prettier. A task written into one of those comes out
looking unlike every other file in the tree.

Three small changes:

- `TatrConfig.formatter` becomes `Schema.Literals(["oxfmt", "prettier"])`, the
  way `Status` is already spelled in the mcp tools.
- `Formatter.format` dispatches on that value. It currently ignores it —
  `onSome: () => runOxfmt(...)` — because there has only ever been one.
- A `runPrettier` beside `runOxfmt`.

## Why it is less work than oxfmt was

`runOxfmt` spawns a subprocess and pipes through stdin only because oxfmt's js
api resolves no config: the cli is the only thing that walks up from the file
for `.oxfmtrc.json`. Prettier's api does that itself.

```ts
const config = await prettier.resolveConfig(file);
const text = await prettier.format(source, { ...config, filepath: file });
```

`resolveConfig` walks up from the path for `.prettierrc`, `prettier.config.js`
and the rest, and `filepath` is what picks the markdown parser. No spawn, no
pipe, no exit code, and none of the care `runOxfmt` needs about draining stdout
before waiting on the child. `format` is a promise in prettier 3, so
`Effect.tryPromise` covers both calls.

Resolve the package the way `oxfmtCli` does, through
`createRequire(context.configPath).resolve("prettier")` and a dynamic import,
rather than `import.meta.resolve`. The version that formats a task should be the
one the repo installed, not whatever this bundle was built against.

## Failing the same way

Naming a formatter the repo does not have is a config error today, and the write
is refused rather than landing unformatted. Keep that: a missing `prettier`
resolve, a config prettier rejects, and a parse failure all go through
`invalid(context, ...)` to the same `ConfigError`, and the task is not written.
