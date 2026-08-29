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
