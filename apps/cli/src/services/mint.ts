import { Context, pipe, DateTime, Effect, Layer, Schema, SchemaGetter } from "effect";
import { fromCrock32String } from "../lib/schema";

const TIME_OFFSET = 4;
const RAND_BYTES = 4;
const ID_BYTE_LENGTH = TIME_OFFSET + RAND_BYTES;

export class TemporalId extends Schema.Opaque<TemporalId>()(
  pipe(
    Schema.Struct({
      created: Schema.DateTimeUtc,
      bytes: Schema.Uint8Array,
    }),
    Schema.encodeTo(
      Schema.Uint8Array.check(Schema.isLengthBetween(ID_BYTE_LENGTH, ID_BYTE_LENGTH)),
      {
        decode: SchemaGetter.transform((bytes) => ({
          created: DateTime.fromEpochSeconds(
            new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false),
          ),
          bytes: bytes.subarray(TIME_OFFSET),
        })),
        encode: SchemaGetter.transform(({ created: time, bytes }) => {
          const outBytes = new Uint8Array(TIME_OFFSET + bytes.byteLength);
          const view = new DataView(outBytes.buffer);

          view.setUint32(0, Math.trunc(time.epochMilliseconds * 1e-3), false);
          outBytes.set(bytes, TIME_OFFSET);

          return outBytes;
        }),
      },
    ),
  ),
) {
  static decode = Schema.decodeEffect(fromCrock32String(this));
  static encode = Schema.encodeEffect(fromCrock32String(this));
}

export class Mint extends Context.Service<Mint>()("@tatr/cli/Mint", {
  make: Effect.gen(function* () {
    return {
      encode: TemporalId.encode,
      decode: TemporalId.decode,
      nextId: Effect.Do.pipe(
        Effect.bind("created", () => DateTime.now),
        Effect.let("bytes", () => globalThis.crypto.getRandomValues(new Uint8Array(RAND_BYTES))),
        Effect.flatMap(TemporalId.encode),
      ),
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
