---
title: Tag format is not validated in schema
priority: 25
tags: bug
closed: true
---

We currently only accept a specific char set in the DSL query language, we don't
check this format in the `TaskInfo` schema though. Should validate here since
this is used for all paths, list, create, update and so on.
