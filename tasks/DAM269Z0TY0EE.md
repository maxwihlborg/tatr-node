---
title: "Read tags and default tag from tatr config"
priority: 50
tags: cli, config
---

Add a `tags` list and a `defaultTag` to `TatrConfig` in `services/config-service.ts`.

- `tags` is the set of tags the repo knows about — feeds completion in the LSP and the `--tag` flag on `tatr new`, and gives `ls` something to validate a `tag:` query against.
- `defaultTag` is applied by `tatr new` (and `create_task` over MCP) when no `--tag` is passed.

Both optional, so a config with only `taskDir` keeps working.


