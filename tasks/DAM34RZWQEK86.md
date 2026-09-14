---
title: Make config.formatter actually be used
priority: 50
tags: core
closed: true
---

When serializing tasks back (new, tag/untag etc) make it read formatter config
field (for now only implement oxfmt).

Should then use `Effect.promise(()=> import('oxfmt'))` (will use nodes normal
resolve mechanisms to find the right version). and then just call the format on
the serialized task.
