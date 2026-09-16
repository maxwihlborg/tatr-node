import {
  Schema,
  Option,
  SchemaGetter,
  Effect,
  Predicate,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import { dual } from "effect/Function";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BITS_PER_CHAR = 5;

export const fromYamlStringTransform = SchemaTransformation.make<unknown, string>({
  decode: SchemaGetter.transformEffect((text, options) =>
    Effect.try({
      catch: () =>
        new SchemaIssue.InvalidValue({ message: "could not be parsed as yaml" }, text, options),
      try: () => parseYaml(text),
    }),
  ),
  encode: SchemaGetter.transform((value) => stringifyYaml(value)),
});

/** Lenient, per Crockford: case-insensitive, with `I`/`L` read as `1` and `O` as `0`.
 * Anything comparing two ids has to fold them the same way the decoder does,
 * or the short form and the long form disagree about `0`. */
export function normalizeCrock32(text: string) {
  return text.toUpperCase().replaceAll(/[IL]/g, "1").replaceAll("O", "0");
}

export const fromCrock32Transform = SchemaTransformation.make<Uint8Array, string>({
  decode: SchemaGetter.transformEffect((text, options) => {
    const out = new Uint8Array(Math.floor((text.length * BITS_PER_CHAR) / 8));
    const normalized = normalizeCrock32(text);
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
const Listish = Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Null]);

function split(n: string | ReadonlyArray<string> | null) {
  return n === null ? [] : Predicate.isString(n) ? n.split(",") : n;
}

export function fromCommaSeparated<S extends Schema.Codec<string, string>>(item: S) {
  return Listish.pipe(
    Schema.decodeTo(Schema.Array(item), {
      decode: SchemaGetter.transform(split),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );
}

/** The same, written back the way front matter spells it: `a, b`. */
export function toCommaSeparated<S extends Schema.Codec<string, string>>(item: S) {
  return Listish.pipe(
    Schema.decodeTo(Schema.Array(item), {
      decode: SchemaGetter.transform(split),
      encode: SchemaGetter.transform((n: ReadonlyArray<string>) => n.join(", ")),
    }),
  );
}

export function fromYamlString<S extends Schema.Top>(schema: S) {
  return Schema.String.pipe(Schema.decodeTo(schema, fromYamlStringTransform));
}

export function fromCrock32String<S extends Schema.ConstraintEncoder<Uint8Array>>(schema: S) {
  return Schema.String.pipe(Schema.decodeTo(schema, fromCrock32Transform));
}

export const omitDefault: {
  <S extends Schema.Top>(
    self: S,
    isDefault: (value: S["Type"]) => boolean,
  ): Schema.decodeTo<Schema.toType<S>, S>;
  <T>(
    isDefault: (value: T) => boolean,
  ): <S extends Schema.ConstraintDecoder<T>>(self: S) => Schema.decodeTo<Schema.toType<S>, S>;
} = dual(2, <S extends Schema.Top>(self: S, isDefault: (value: S["Type"]) => boolean) =>
  self.pipe(
    Schema.decodeTo(Schema.toType(self), {
      decode: SchemaGetter.passthrough(),
      encode: SchemaGetter.transformOptional(
        Option.filter((value: S["Type"]) => !isDefault(value)),
      ),
    }),
  ),
);
