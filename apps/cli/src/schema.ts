import { Effect, FileSystem, Predicate, Schema, SchemaGetter, SchemaTransformation } from "effect";
import { fromYamlString } from "./lib/schema";

export const TaskTag = Schema.String.pipe(
  Schema.decodeTo(Schema.Trim, SchemaTransformation.toLowerCase()),
);

export const TaskTagArray = Schema.Union([Schema.String, Schema.Array(Schema.String)]).pipe(
  Schema.decodeTo(Schema.Array(TaskTag), {
    decode: SchemaGetter.transform((n) => (Predicate.isString(n) ? n.split(",") : n)),
    encode: SchemaGetter.passthrough(),
  }),
);

export class TaskInfo extends Schema.Opaque<TaskInfo>()(
  Schema.Struct({
    title: Schema.String,
    priority: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(50))),
    tags: TaskTagArray.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  }),
) {
  static decodeYaml = Schema.decodeEffect(fromYamlString(this));
}

export interface Task {
  id: string;
  file: string;
  info: TaskInfo;
  stat: FileSystem.File.Info;
}
