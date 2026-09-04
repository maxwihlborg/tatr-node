import * as clr from "colorette";
import { Context, Effect, Layer, Path } from "effect";
import type { Task } from "../schema.js";

export class Printer extends Context.Service<Printer>()("@tatr/cli/Printer", {
  make: Effect.gen(function* () {
    const path = yield* Path.Path;

    const richPrio = (n: number) => {
      if (n <= 25) {
        return clr.blue(n);
      }
      if (n <= 50) {
        return clr.green(n);
      }
      return clr.red(n);
    };

    const richTags = (n: ReadonlyArray<string>) => {
      if (!n.length) {
        return "";
      }
      return `${clr.gray(", tags:")} ${clr.magenta(n.join(clr.gray(", ")))}`;
    };

    const plainTags = (n: ReadonlyArray<string>) => {
      if (!n.length) {
        return "";
      }
      return `, tags: ${n.join(", ")}`;
    };

    return {
      vimgrep(task: Task) {
        return `${path.relative(process.cwd(), task.file)}:1:1 [priority: ${task.info.priority}${plainTags(task.info.tags)}] ${task.info.title}`;
      },
      showTask(task: Task) {
        return `${task.id}: ${clr.gray("[priority:")} ${richPrio(task.info.priority)}${richTags(task.info.tags)}${clr.gray("]")} ${task.info.title}`;
      },
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
