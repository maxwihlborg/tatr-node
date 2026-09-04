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
    closed: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  }),
) {
  static decodeYaml = Schema.decodeEffect(fromYamlString(this));
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
