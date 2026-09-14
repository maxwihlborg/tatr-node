import { Option } from "effect";

const DELIMITERS = [
  ["[", "]"],
  ["(", ")"],
] as const;

const ID = /^[0-9A-Za-z]+$/;

// the words come out of the config, so they can hold anything a yaml key can
const ESCAPE = /[.*+?^${}()|[\]\\]/g;

export interface Marker {
  readonly word: string;
  readonly tags: ReadonlyArray<string>;
  /** where `WORD:` starts and ends, the span an id is written into */
  readonly from: number;
  readonly to: number;
  readonly title: string;
}

/** A marker word to the tags a task made from it carries, compiled once. */
export class Markers {
  readonly pattern: Option.Option<RegExp>;
  private readonly tags: Map<string, ReadonlyArray<string>>;

  constructor(readonly words: Record<string, ReadonlyArray<string>>) {
    const escaped = Object.keys(words).map((word) => word.replace(ESCAPE, "\\$&"));

    this.pattern = Option.map(
      Option.liftPredicate(escaped, (n) => n.length > 0),
      // FIXME(DAF9GK681Q510): Should make colon optional
      (n) => new RegExp(`\\b(${n.join("|")}):`, "i"),
    );
    this.tags = new Map(Object.entries(words).map(([word, tags]) => [word.toLowerCase(), tags]));
  }

  /**
   * The first unclaimed marker on the line, matched whatever its case. A marker
   * that already carries an id reads as `WORD(<id>):`, so looking for a bare
   * `WORD:` skips it.
   */
  markerAt(line: string): Option.Option<Marker> {
    if (Option.isNone(this.pattern)) {
      return Option.none();
    }

    const match = this.pattern.value.exec(line);

    if (!match) {
      return Option.none();
    }

    // the word as written, so rewriting it keeps the case the reader chose
    const word = match[1]!;
    const to = match.index + word.length + 1;

    return Option.some({
      word,
      tags: this.tags.get(word.toLowerCase()) ?? [],
      from: match.index,
      to,
      title: line.slice(to).trim(),
    });
  }
}

/**
 * Where an id is being typed: the span between the delimiter the cursor sits
 * behind and the cursor itself, which is what a completion replaces. Anything
 * but id characters in between means the reader was writing prose, not an id.
 */
export function idSpanAt(
  line: string,
  character: number,
): Option.Option<{ from: number; to: number }> {
  const before = line.slice(0, character);

  for (const [open] of DELIMITERS) {
    const from = before.lastIndexOf(open) + 1;

    if (from > 0 && (from === character || ID.test(before.slice(from)))) {
      return Option.some({ from, to: character });
    }
  }

  return Option.none();
}

/**
 * The id the cursor sits in, as written by the editor plugin: `[<id>]: title`
 * or `FIXME(<id>): title`. Either delimiter counts as being inside.
 */
export function idAt(line: string, character: number): Option.Option<string> {
  for (const [open, close] of DELIMITERS) {
    let from = -1;

    for (let i = 0; i < line.length; i++) {
      if (line[i] === open) {
        from = i;
      } else if (line[i] === close && from >= 0) {
        const id = line.slice(from + 1, i);

        if (character >= from && character <= i && ID.test(id)) {
          return Option.some(id);
        }

        from = -1;
      }
    }
  }

  return Option.none();
}
