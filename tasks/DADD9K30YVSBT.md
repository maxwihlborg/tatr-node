---
title: "Mint and upsert tasks"
priority: 25
tags: nvim
closed: true
---

Would be nice be nice if under a using a keybinding one could mint a new id in
vim, inserting `[id]: ` into the buffer

User then input the title eg.

```ts
// [DADD9K30YVSBT]: Mint and upsert tasks`
function function() {}
```

Then by having the cursor on the line with the id and running `TaskrUpsert` or
something would create and open the new task (everything after : if available
set as the title)

Probably add a new binding in config for `upsert`
