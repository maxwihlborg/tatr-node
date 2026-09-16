import { Effect, Schema, SchemaTransformation } from "effect";
import { fromYamlString, omitDefault, toCommaSeparated } from "./lib/schema";

/** The same charset the query DSL reads after its `.` or `:`, so a tag that
 * lands here is one a query can name. Checked past the trim and the lowercase,
 * which is why casing and padding still pass. */
export const TaskTag = Schema.String.pipe(
  Schema.decodeTo(Schema.Trim, SchemaTransformation.toLowerCase()),
  Schema.check(
    Schema.isPattern(/^[a-z0-9_-]+$/, {
      expected: "a tag of a-z, 0-9, '-' and '_'",
    }),
  ),
);

export const TaskTagArray = toCommaSeparated(TaskTag);

export class TaskInfo extends Schema.Opaque<TaskInfo>()(
  Schema.StructWithRest(
    Schema.Struct({
      title: Schema.String,
      priority: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(50))),
      tags: TaskTagArray.pipe(
        Schema.withDecodingDefault(Effect.succeed([])),
        omitDefault((tags: ReadonlyArray<string>) => tags.length === 0),
      ),
      closed: Schema.Boolean.pipe(
        Schema.withDecodingDefault(Effect.succeed(false)),
        omitDefault((closed: boolean) => !closed),
      ),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
) {
  static decodeYaml = Schema.decodeEffect(fromYamlString(this));
  static encodeYaml = Schema.encodeEffect(fromYamlString(this));
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
