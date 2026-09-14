---
title: "Read default sort order from tatr config"
priority: 50
tags: cli, config
---

The `--order` flag on `tatr ls` hard codes `["-priority", "title"]` as its default (`commands/list-tasks.ts`). Move that default into `TatrConfig` as an optional `order`, falling back to the current pair when the key is absent, so a repo can decide its own listing order once.

Worth checking the other list front ends while in here — the fzf path and the MCP `list_tasks` tool take an order too.


