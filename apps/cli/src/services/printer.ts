import * as clr from "colorette";
import { Context, Effect, Layer } from "effect";
import type { Task } from "../schema.js";

export class Printer extends Context.Service<Printer>()("@tatr/cli/Printer", {
  make: Effect.gen(function* () {
    return {
      showTask(task: Task) {
        const prio = (n: number) => {
          if (n <= 25) {
            return clr.blue(n);
          }
          if (n <= 50) {
            return clr.green(n);
          }
          return clr.red(n);
        };

        const tags = (n: ReadonlyArray<string>) => {
          if (!n.length) {
            return "";
          }
          return `${clr.gray(", tags:")} ${clr.magenta(n.join(clr.gray(", ")))}`;
        };

        return `${task.id}: ${clr.gray("[priority:")} ${prio(task.info.priority)}${tags(task.info.tags)}${clr.gray("]")} ${task.info.title}`;
      },
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
