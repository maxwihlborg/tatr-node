---
title: Extend config command
priority: 80
tags: cli, config
closed: true
---

Should still print absolute path to task `dir`

```shell
tatr config
# { config: {...}, root: "/user/bla/code/bar/tasks" } etc
```

Full effect Schema.Struct for output and then move the jsonString thingymybob
around this structure.

Probably remove `tatr root`
