import { Array, Option, Schema, String } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { Argument, Flag } from "effect/unstable/cli";
import { TaskTagArray } from "../schema.js";
import { Query } from "../services/index.js";

export const idArgument = Argument.String("id").pipe(
  Argument.withDescription("Id of the task"), //
);

export function queryArgument(options: { description: string }) {
  return Argument.variadic(Argument.String("query")).pipe(
    Argument.withDescription(options.description),
    Argument.map((q) => Query.normalize(q, " ")),
    Argument.map(Option.liftPredicate(String.isNonEmpty)),
  );
}

export function statusFlag(options: { description: string }) {
  return Flag.Literals("status", ["open", "closed", "all"]).pipe(
    Flag.withAlias("s"),
    Flag.withDescription(options.description),
  );
}

export function formatFlag<const A extends NonEmptyReadonlyArray<string>>(options: { values: A }) {
  return Flag.Literals("format", options.values).pipe(
    Flag.withAlias("f"),
    Flag.withDescription("Output format"),
    Flag.withDefault<A[number]>(options.values[0]),
  );
}

export function tagFlag(options: { description: string }) {
  return Flag.atLeast(
    Flag.withSchema(
      Flag.String("tag"), //
      Schema.String.pipe(Schema.decodeTo(TaskTagArray)),
    ),
    1,
  ).pipe(
    Flag.withAlias("t"), //
    Flag.withDescription(options.description),
    Flag.map(Array.flatten),
  );
}
