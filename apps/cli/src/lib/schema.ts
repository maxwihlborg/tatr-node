import {
  Schema,
  SchemaGetter,
  Effect,
  Predicate,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import { Yaml } from "effect/unstable/encoding";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BITS_PER_CHAR = 5;

export const fromYamlStringTransform = SchemaTransformation.make<unknown, string>({
  decode: SchemaGetter.transformOrFail((text, options) =>
    Effect.try({
      catch: () =>
        new SchemaIssue.InvalidValue({ message: "could not be parsed as yaml" }, text, options),
      try: () => Yaml.parse(text),
    }),
  ),
  encode: SchemaGetter.forbidden(() => "Yaml encoding is not supported by effect"),
});

export const fromCrock32Transform = SchemaTransformation.make<Uint8Array, string>({
  decode: SchemaGetter.transformOrFail((text, options) => {
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
  encode: SchemaGetter.transform((bytes) => {
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

/**
 * A list yaml can spell any of the three ways: `a, b`, `[a, b]`, and a key with
 * nothing under it at all, which yaml reads as null and this reads as empty.
 */
export function fromCommaSeparated<S extends Schema.Codec<string, string>>(item: S) {
  return Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Null]).pipe(
    Schema.decodeTo(Schema.Array(item), {
      decode: SchemaGetter.transform((n) =>
        n === null ? [] : Predicate.isString(n) ? n.split(",") : n,
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );
}

export function fromYamlString<S extends Schema.Top>(schema: S) {
  return Schema.String.pipe(Schema.decodeTo(schema, fromYamlStringTransform));
}

export function fromCrock32String<S extends Schema.ConstraintEncoder<Uint8Array>>(schema: S) {
  return Schema.String.pipe(Schema.decodeTo(schema, fromCrock32Transform));
}
