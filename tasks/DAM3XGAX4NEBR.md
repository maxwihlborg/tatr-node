---
title: Long titles break round tripping through oxfmt
priority: 70
tags: core, bug
closed: true
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

`yaml` (eemeli) is the candidate: 686 kB unpacked but zero dependencies, esm
first, yaml 1.2, and it serializes as well as parses. That second half is what
makes this worth a dependency — `lib/schema.ts` forbids yaml encoding,
`TaskInfo.formatYaml` hand writes four keys because of it, and every rewrite
therefore drops front matter keys outside the schema. Its `parseDocument` keeps
key order and comments across a round trip.

Done, both halves. `lib/schema.ts` reads and writes front matter with `yaml`,
`TaskInfo` carries a `Schema.Record` rest so keys outside the schema survive a
rewrite, and `formatYaml` is gone in favour of `encodeYaml` through the schema.
`omitDefault` keeps the shape the hand written one had — no `closed: false`, no
empty `tags`, tags joined with `, ` — and the serializer quotes a title only
when it must, so titles lose their unconditional quotes as files are rewritten.

What it cost, `just build` either side:

```
         raw                        gzipped
before   634409                     186529
after    738120                     217515
delta   +103711  (+16.35%)          +30986  (+16.61%)
```
