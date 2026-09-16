import { Data, Result } from "effect";

export type PatchOp =
  | { readonly op: "replace"; old_string: string; new_string: string; replace_all?: boolean }
  | { readonly op: "insert_before"; anchor: string; text: string }
  | { readonly op: "insert_after"; anchor: string; text: string }
  | { readonly op: "prepend"; text: string }
  | { readonly op: "append"; text: string }
  | { readonly op: "replace_range"; from: string; to: string; new_string: string };

export class PatchError extends Data.TaggedError("PatchError")<{
  readonly index: number;
  readonly op: PatchOp["op"];
  readonly anchor: string;
  readonly found: number;
}> {
  override get message() {
    const what = this.found === 0 ? "matched nothing" : `matched ${this.found} times`;

    return `patch[${this.index}] ${this.op}: ${JSON.stringify(this.anchor)} ${what}`;
  }
}

interface Span {
  readonly start: number;
  readonly end: number;
}

function isSpace(char: string | undefined) {
  return char !== undefined && /\s/.test(char);
}

/**
 * Whether the anchor sits at `from`, with whitespace elastic: a run of it
 * matches a run of any length, which is what carries an anchor across the line
 * the formatter wrapped it at. The end is the last character the anchor
 * actually spelled, never the run after it.
 */
function spanAt(body: string, anchor: string, from: number) {
  let i = from;
  let j = 0;

  while (j < anchor.length) {
    if (isSpace(anchor[j])) {
      if (!isSpace(body[i])) {
        return -1;
      }
      while (j < anchor.length && isSpace(anchor[j])) j++;
      while (i < body.length && isSpace(body[i])) i++;
    } else {
      if (body[i] !== anchor[j]) {
        return -1;
      }
      i++;
      j++;
    }
  }

  return i;
}

/** Every place the anchor sits, left to right and never overlapping. */
export function spansOf(body: string, anchor: string): ReadonlyArray<Span> {
  const needle = anchor.trim();
  const spans: Array<Span> = [];

  if (needle === "") {
    return spans;
  }

  for (let start = 0; start < body.length; start++) {
    const end = spanAt(body, needle, start);

    if (end >= 0) {
      spans.push({ start, end });
      start = end - 1;
    }
  }

  return spans;
}

function splice(body: string, span: Span, text: string) {
  return body.slice(0, span.start) + text + body.slice(span.end);
}

function onlySpan(body: string, anchor: string, index: number, op: PatchOp["op"]) {
  const spans = spansOf(body, anchor);

  return spans.length === 1
    ? Result.succeed(spans[0]!)
    : Result.fail(new PatchError({ index, op, anchor, found: spans.length }));
}

function step(body: string, patch: PatchOp, index: number): Result.Result<string, PatchError> {
  switch (patch.op) {
    case "prepend": {
      return Result.succeed(patch.text + body);
    }
    case "append": {
      return Result.succeed(body + patch.text);
    }
    case "replace": {
      if (patch.replace_all) {
        const spans = spansOf(body, patch.old_string);

        if (spans.length === 0) {
          return Result.fail(
            new PatchError({ index, op: patch.op, anchor: patch.old_string, found: 0 }),
          );
        }

        // right to left, so an earlier span's indices survive a later splice
        return Result.succeed(
          spans.reduceRight((acc, span) => splice(acc, span, patch.new_string), body),
        );
      }

      return Result.map(onlySpan(body, patch.old_string, index, patch.op), (span) =>
        splice(body, span, patch.new_string),
      );
    }
    case "insert_before": {
      return Result.map(onlySpan(body, patch.anchor, index, patch.op), (span) =>
        splice(body, { start: span.start, end: span.start }, patch.text),
      );
    }
    case "insert_after": {
      return Result.map(onlySpan(body, patch.anchor, index, patch.op), (span) =>
        splice(body, { start: span.end, end: span.end }, patch.text),
      );
    }
    case "replace_range": {
      return Result.flatMap(onlySpan(body, patch.from, index, patch.op), (from) => {
        const tail = body.slice(from.end);
        const spans = spansOf(tail, patch.to);

        if (spans.length !== 1) {
          return Result.fail(
            new PatchError({ index, op: patch.op, anchor: patch.to, found: spans.length }),
          );
        }

        // `to` is exclusive and stays where it is
        return Result.succeed(
          splice(body, { start: from.start, end: from.end + spans[0]!.start }, patch.new_string),
        );
      });
    }
  }
}

/**
 * The ops in order, each seeing what the one before it left, and none of them
 * seeing disk: a failure anywhere is the whole patch, not half of it.
 */
export function applyPatch(
  body: string,
  ops: ReadonlyArray<PatchOp>,
): Result.Result<string, PatchError> {
  let acc = body;

  for (const [index, op] of ops.entries()) {
    const next = step(acc, op, index);

    if (Result.isFailure(next)) {
      return next;
    }

    acc = next.success;
  }

  return Result.succeed(acc);
}
