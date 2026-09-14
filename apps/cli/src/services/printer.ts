import * as clr from "colorette";
import { Context, Effect, Layer, Path } from "effect";
import type { Task, TaskWithBody } from "../schema.js";

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

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
      vimgrep(base: string, task: Task) {
        return `${path.relative(base, task.file)}:1:1 [priority: ${task.info.priority}${plainTags(task.info.tags)}] ${task.info.title}`;
      },
      /** The body is written verbatim: it is markdown meant to be read, and
       * escaping it would only make it harder to. */
      agentTask(task: TaskWithBody) {
        return [
          `<task id="${escapeXml(task.id)}" file="${escapeXml(task.file)}">`,
          `<title>${escapeXml(task.info.title)}</title>`,
          `<priority>${task.info.priority}</priority>`,
          ...(task.info.tags.length
            ? [`<tags>${escapeXml(task.info.tags.join(", "))}</tags>`]
            : []),
          `<status>${task.info.closed ? "closed" : "open"}</status>`,
          ...(task.body ? ["<body>", task.body.trim(), "</body>"] : []),
          "</task>",
        ].join("\n");
      },
      /** The whole id, with the trailing `unique` characters that name it on
       * their own picked out of the part it shares with its neighbours. */
      showTask(task: Task, unique = task.id.length) {
        const cut = Math.max(0, task.id.length - unique);
        const id = `${clr.gray(task.id.slice(0, cut))}${clr.bold(clr.yellow(task.id.slice(cut)))}`;

        return `${id}: ${clr.gray("[priority:")} ${richPrio(task.info.priority)}${richTags(task.info.tags)}${clr.gray("]")} ${task.info.title}`;
      },
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
