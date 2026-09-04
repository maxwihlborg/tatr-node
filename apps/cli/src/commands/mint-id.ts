import { Console, DateTime, Effect, pipe, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { Mint } from "../services/index.js";

export const mintId = pipe(
  Command.make("mint", {
    created: Flag.string("created").pipe(
      Flag.withDescription("Mint the id as of this date instead of now"),
      Flag.withSchema(Schema.DateTimeUtcFromString),
      Flag.withDefault(DateTime.now),
    ),
  }),
  Command.withDescription("Mint a task id without creating a task"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ created }) {
      const mint = yield* Mint;
      const id = yield* mint.idAt(created);

      yield* Console.log(id);
    }),
  ),
  Command.provide(Mint.layer),
);
