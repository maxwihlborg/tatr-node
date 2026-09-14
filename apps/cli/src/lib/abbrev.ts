import { Array, Order } from "effect";
import { normalizeCrock32 } from "./schema.js";

function reverse(text: string) {
  return globalThis.Array.from(text).reverse().join("");
}

function commonPrefixLength(left: string, right: string) {
  const bound = Math.min(left.length, right.length);
  let length = 0;
  while (length < bound && left[length] === right[length]) {
    length++;
  }
  return length;
}

/**
 * How many trailing characters of each id no other id shares. Ids abbreviate
 * from the right because `Mint` writes the epoch seconds first, leaving
 * everything minted in the same week sharing its leading characters.
 */
export function shortestUniqueSuffixes(ids: Iterable<string>): Map<string, number> {
  const keyed = Array.map(globalThis.Array.from(ids), (id) => ({
    id,
    key: reverse(normalizeCrock32(id)),
  }));
  const sorted = Array.sort(
    keyed,
    Order.mapInput<string, { key: string }>(Order.String, (n) => n.key),
  );
  const lengths = new Map<string, number>();

  for (let index = 0; index < sorted.length; index++) {
    const { id, key } = sorted[index]!;
    const before = index > 0 ? commonPrefixLength(key, sorted[index - 1]!.key) : 0;
    const after = index < sorted.length - 1 ? commonPrefixLength(key, sorted[index + 1]!.key) : 0;

    lengths.set(id, Math.min(key.length, Math.max(before, after) + 1));
  }

  return lengths;
}

export function matchingIds(ids: Iterable<string>, abbrev: string): ReadonlyArray<string> {
  const wanted = normalizeCrock32(abbrev);

  if (wanted.length === 0) {
    return [];
  }

  return Array.filter(globalThis.Array.from(ids), (id) => normalizeCrock32(id).endsWith(wanted));
}
