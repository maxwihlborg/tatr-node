---
title: Split the bundle per subcommand
priority: 40
tags: core, cli
closed: true
---

Every invocation parses and initialises the whole bundle. `tatr ls` pulls in the
mcp server, the ai toolkit, the rpc layer and the lsp alongside the code it
actually runs.

```
tatr ls      ~100ms wall
bare node     ~20ms
```

Most invocations do not care. The picker does: `ls --fzf` and the neovim fzf-lua
picker re-run `tatr ls` on every keystroke behind a 150ms debounce, so most of
that window is process startup rather than filtering.

The lever is a dynamic import per subcommand in `index.ts`, so the dispatcher
stays small and rolldown splits `lsp/`, `mcp/` and the heavier commands into
chunks nothing else loads. Measure the hot path either side, not just the total
— the total will barely move.

Worth doing when the picker annoys someone, not before.

Done for the two servers. `commands/start-lsp.ts` and `commands/start-mcp.ts`
hold the name and the description, which the parser needs eagerly, and reach
their layer through `Effect.promise(() => import(…))`; `lsp/index.ts` and
`mcp/index.ts` export `run` instead of a command. Rolldown splits on that.

```
         index     lsp      mcp    Logger
before  738281       –        –         –
after   481159  147187    63100     54218
```

Same source built both ways, 30 runs of `tatr ls` each, run twice in both
orders:

```
unsplit  2.82s / 2.83s   94.2ms per run
split    2.46s / 2.45s   81.8ms per run
```

So 12ms an invocation, a third off what the hot path parses. The commands
themselves are still eager — they are small, but they pull the services in.
Whether there is more to win there is unmeasured; what is left after this is
mostly effect's own init, which no amount of splitting reaches.
