import { expect, layer } from "@effect/vitest";
import { Effect, Array, DateTime, Order } from "effect";
import { Mint } from "../mint";

const KNOWN_ID = "DABPE001081G8";
const KNOWN_MILLIS = 1788307200_000;

layer(Mint.layer)("mint", (it) => {
  it.effect("decodes a known id", () => {
    return Effect.gen(function* () {
      const mint = yield* Mint;
      const id = yield* mint.decode(KNOWN_ID);

      expect(id.created.epochMilliseconds).toBe(KNOWN_MILLIS);
      expect([...id.bytes]).toEqual([1, 2, 3, 4]);
    });
  });

  it.effect("encodes a known id", () => {
    return Effect.gen(function* () {
      const mint = yield* Mint;

      const encoded = yield* mint.encode({
        created: DateTime.fromEpochSeconds(KNOWN_MILLIS * 1e-3),
        bytes: new Uint8Array([1, 2, 3, 4]),
      });

      expect(encoded).toBe(KNOWN_ID);
    });
  });

  it.effect("mints ids that round trip", () => {
    return Effect.gen(function* () {
      const mint = yield* Mint;
      const encoded = yield* mint.nextId;
      const id = yield* mint.decode(encoded);

      expect(encoded).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
      expect(id.bytes.byteLength).toBe(4);
      expect(yield* mint.encode(id)).toBe(encoded);
    });
  });

  it.effect("sorts lexicographically by creation time", () => {
    return Effect.gen(function* () {
      const mint = yield* Mint;
      const ids = ["ZZZZZZZZZZZZ8", "DABPE001081G8", "0000000000008", "M00000000000G"];
      const decoded = yield* Effect.forEach(ids, (id) =>
        Effect.map(mint.decode(id), (it) => ({ id, millis: it.created.epochMilliseconds })),
      );

      const byString = Array.sort(
        decoded,
        Order.mapInput<string, { id: string }>(Order.String, (n) => n.id),
      );

      const byTime = Array.sort(
        decoded,
        Order.mapInput<number, { millis: number }>(Order.Number, (n) => n.millis),
      );

      expect(new Set(decoded.map((it) => it.millis)).size).toBe(ids.length);
      expect(byString).toEqual(byTime);
    });
  });

  it.effect("decodes leniently", () => {
    return Effect.gen(function* () {
      const mint = yield* Mint;
      const canonical = yield* mint.decode(KNOWN_ID);

      // Lowercase, plus Crockford's `O` -> `0` and `I`/`L` -> `1` aliases.
      for (const variant of ["dabpe001081g8", "DABPEOOIO8IG8", "dabpeoolo8lg8"]) {
        const id = yield* mint.decode(variant);

        expect(id.created.epochMilliseconds).toBe(canonical.created.epochMilliseconds);
        expect([...id.bytes]).toEqual([...canonical.bytes]);
      }
    });
  });

  it.effect("rejects malformed ids", () => {
    return Effect.gen(function* () {
      const mint = yield* Mint;

      // `U` is excluded from the alphabet, `!` was never in it.
      expect(String(yield* Effect.flip(mint.decode("DABPE001081GU")))).toContain(
        "Crockford base32",
      );
      expect(String(yield* Effect.flip(mint.decode("DABPE001081G!")))).toContain(
        "Crockford base32",
      );
      // 12 chars decodes to 7 bytes, one short of an id.
      expect(String(yield* Effect.flip(mint.decode("DABPE001081G")))).toContain("length of 8");
    });
  });
});
