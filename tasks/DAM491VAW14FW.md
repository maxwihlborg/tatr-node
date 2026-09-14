---
title: "Split the bundle per subcommand"
priority: 40
tags: core, cli
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
