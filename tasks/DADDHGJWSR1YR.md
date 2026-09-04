---
title: "Turn TODO/FIXME comments into tasks"
priority: 50
tags: nvim
closed: true
---

`:TatrTodo` on a line holding `TODO:` or `FIXME:` mints an id, creates the task with the text after the marker as its title, and rewrites the marker to `FIXME(<id>):` in place. Nothing is opened.

The marker -> tags map lives in config, `FIXME` carrying `bug` by default.


