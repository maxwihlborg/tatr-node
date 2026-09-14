---
title: "Long titles break round tripping through oxfmt"
priority: 70
tags: core, bug
---

A title long enough to pass the print width makes oxfmt fold the yaml scalar
across lines:

```yaml
title:
  "A title so long that the formatter will certainly fold it across more than
  one line in the yaml front matter"
```

which `Yaml.parse` refuses — `Unexpected indentation of 2 spaces at line 3` — so
the task lists as `!! BROKEN, INVALID FRONTMATTER !!` and `show`/`close` fail on
it. Reachable from `tatr new` with `formatter: oxfmt`, and from
`just format-tasks` on any repo whether or not tatr wrote the file.

The real fix is a yaml library that reads what yaml allows, at the cost of a
much larger bundle. Splitting front matter off with a regex before formatting is
not it — the repo parses front matter properly everywhere else.
