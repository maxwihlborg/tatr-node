---
title: "Read markers from tatr config"
priority: 50
closed: true
tags: cli, config, lsp
---

The `TODO`/`FIXME`/`FEAT` to tags mapping is hard coded twice, in
`lib/marker.ts` and again in the neovim plugin's `markers` option. Move it into
`tatr.config.yaml` so a marker means the same thing wherever it is claimed from.

- `markers` on `TatrConfig`, decoding to a class that compiles the match pattern
  once rather than per line.
- `tatr config` prints the resolved config as json, which is how the plugin
  reads it — its own `markers` option goes away.
