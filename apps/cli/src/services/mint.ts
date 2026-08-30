import {
  Context,
  DateTime,
  Effect,
  Layer,
  Schema,
  SchemaGetter,
  SchemaIssue,
  SchemaTransformation,
} from "effect";

const TIME_OFFSET = 4;
const RAND_BYTES = 4;
const ID_BYTE_LENGTH = TIME_OFFSET + RAND_BYTES;

/**
 * Crockford base32: `0-9A-Z` minus `I`, `L`, `O` and `U`. The alphabet is ASCII-ascending, so
 * the lexicographic order of an encoded id matches the byte order of its input.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BITS_PER_CHAR = 5;

const fromCrock32 = SchemaTransformation.make({
  decode: SchemaGetter.transformOrFail<Uint8Array, string>((text, options) => {
    const out = new Uint8Array(Math.floor((text.length * BITS_PER_CHAR) / 8));
    // Lenient, per Crockford: case-insensitive, with `I`/`L` read as `1` and `O` as `0`.
    const normalized = text.toUpperCase().replaceAll(/[IL]/g, "1").replaceAll("O", "0");
    let buffer = 0;
    let bits = 0;
    let index = 0;

    for (const char of normalized) {
      const value = ALPHABET.indexOf(char);

      if (value < 0) {
        return Effect.fail(
          new SchemaIssue.InvalidValue({ expected: "a Crockford base32 string" }, text, options),
        );
      }

      buffer = (buffer << BITS_PER_CHAR) | value;
      bits += BITS_PER_CHAR;

      if (bits >= 8) {
        bits -= 8;
        out[index++] = (buffer >>> bits) & 0xff;
      }
    }

    return Effect.succeed(out);
  }),
  encode: SchemaGetter.transform<string, Uint8Array>((bytes) => {
    let out = "";
    let buffer = 0;
    let bits = 0;

    for (const byte of bytes) {
      buffer = (buffer << 8) | byte;
      bits += 8;

      while (bits >= BITS_PER_CHAR) {
        bits -= BITS_PER_CHAR;
        out += ALPHABET[(buffer >>> bits) & 0x1f];
      }
    }

    // Left-aligned: leftover low bits are zero-padded rather than shifted down, which is what
    // keeps a fixed-width id order-preserving.
    if (bits > 0) {
      out += ALPHABET[(buffer << (BITS_PER_CHAR - bits)) & 0x1f];
    }

    return out;
  }),
});

export class TemporalId extends Schema.Opaque<TemporalId>()(
  Schema.Struct({
    created: Schema.DateTimeUtc,
    bytes: Schema.Uint8Array,
  }),
) {}

export const TemporalIdFromString = TemporalId.pipe(
  Schema.encodeTo(
    Schema.String.pipe(Schema.decodeTo(Schema.Uint8Array, fromCrock32)).check(
      Schema.isLengthBetween(ID_BYTE_LENGTH, ID_BYTE_LENGTH),
    ),
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
);

export class Mint extends Context.Service<Mint>()("@tatr/cli/Mint", {
  make: Effect.gen(function* () {
    return {
      encode: Schema.encodeEffect(TemporalIdFromString),
      decode: Schema.decodeEffect(TemporalIdFromString),
      nextId: Effect.Do.pipe(
        Effect.bind("created", () => DateTime.now),
        Effect.let("bytes", () => globalThis.crypto.getRandomValues(new Uint8Array(RAND_BYTES))),
        Effect.flatMap(Schema.encodeEffect(TemporalIdFromString)),
      ),
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
