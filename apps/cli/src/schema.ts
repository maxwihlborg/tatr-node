import {
  Effect,
  Predicate,
  Schema,
  SchemaGetter,
  SchemaIssue,
  SchemaTransformation,
  FileSystem,
} from "effect";
import { Yaml } from "effect/unstable/encoding";

function fromYamlString<S extends Schema.Top>(schema: S) {
  return Schema.String.pipe(
    Schema.decodeTo(schema, {
      decode: SchemaGetter.transformOrFail((input) =>
        Effect.try({
          catch: () => new SchemaIssue.InvalidValue({ message: "could not be parsed as yaml" }),
          try: () => Yaml.parse(input),
        }),
      ),
      encode: SchemaGetter.forbidden(() => "Yaml encoding is not supported, yet"),
    }),
  );
}

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
