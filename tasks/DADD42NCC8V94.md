---
title: Catch and print domain errors in the main application
priority: 50
closed: true
---

Main program is a pretty good place to catch and print (exit with non-zero) for
our defined domain errors

```ts
Effect.catch((err) => {
  switch (err._tag) {
    /* .... */
  }

  return Effect.die(err);
});
```
