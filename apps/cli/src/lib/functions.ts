import { type Order, Array, Stream, Effect } from "effect";
import { dual } from "effect/Function";

export function unreachable(_: never): never {
  return _;
}

export const mapUpsert: {
  <K, V>(key: NoInfer<K>, fn: (key: NoInfer<K>) => NoInfer<V>): (self: Map<K, V>) => V;
  <K, V>(self: Map<K, V>, key: NoInfer<K>, fn: (key: NoInfer<K>) => NoInfer<V>): V;
} = dual(3, <K, V>(self: Map<K, V>, key: NoInfer<K>, fn: (key: NoInfer<K>) => NoInfer<V>): V => {
  if (!self.has(key)) {
    self.set(key, fn(key));
  }
  return self.get(key)!;
});

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", globalThis.String.raw`'\''`)}'`;
}

export const runCollectSorted: {
  <A, E, R>(
    self: Stream.Stream<A, E, R>,
    order: Order.Order<A>,
  ): Effect.Effect<ReadonlyArray<A>, E, R>;
  <A>(
    order: Order.Order<A>,
  ): <E, R>(self: Stream.Stream<A, E, R>) => Effect.Effect<ReadonlyArray<A>, E, R>;
} = dual(
  2,
  <A, E, R>(
    self: Stream.Stream<A, E, R>,
    order: Order.Order<A>,
  ): Effect.Effect<ReadonlyArray<A>, E, R> => {
    return Effect.map(Stream.runCollect(self), Array.sort(order));
  },
);
