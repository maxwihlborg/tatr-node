import { Effect, Schema, SchemaTransformation } from "effect";
import { fromCommaSeparated, fromYamlString } from "./lib/schema";

export const TaskTag = Schema.String.pipe(
  Schema.decodeTo(Schema.Trim, SchemaTransformation.toLowerCase()),
);

export const TaskTagArray = fromCommaSeparated(TaskTag);

export class TaskInfo extends Schema.Opaque<TaskInfo>()(
  Schema.Struct({
    title: Schema.String,
    priority: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(50))),
    tags: TaskTagArray.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
    closed: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  }),
) {
  static decodeYaml = Schema.decodeEffect(fromYamlString(this));
  static formatYaml({ tags, title, priority, closed }: TaskInfo) {
    return [
      `title: ${JSON.stringify(title)}`,
      `priority: ${priority}`,
      closed && `closed: true`,
      tags.length > 0 && `tags: ${tags.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

export class Task extends Schema.Opaque()(
  Schema.Struct({
    id: Schema.String,
    file: Schema.String,
    info: TaskInfo,
    stat: Schema.Struct({
      mtime: Schema.OptionFromNullOr(Schema.Date),
      atime: Schema.OptionFromNullOr(Schema.Date),
      birthtime: Schema.OptionFromNullOr(Schema.Date),
      size: Schema.BigInt,
    }),
  }),
) {
  static encode = Schema.encodeEffect(this);
  static decode = Schema.decodeEffect(this);
}

export class TaskWithBody extends Schema.Opaque<TaskWithBody>()(
  Schema.Struct({
    id: Schema.String,
    file: Schema.String,
    info: TaskInfo,
    body: Schema.String,
  }),
) {
  static encode = Schema.encodeEffect(this);
  static decode = Schema.decodeEffect(this);
}
