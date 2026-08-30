import { Data, Option, Pipeable, Array, Result, Effect } from "effect";
import { dual, type LazyArg } from "effect/Function";
import { SingleShotGen } from "effect/Utils";
import { mapUpsert } from "./functions.js";
import type { NonEmptyReadonlyArray } from "effect/Array";

export const TypeId = "@tatr/cli/parser" as const;

export interface Parser<out A> extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId;
  readonly "~type.value": A;

  parse(input: string, index: number): ParseResult<A>;
  [Symbol.iterator](): ParserIterator<A>;
}

export type Top = Parser<unknown>;
export interface ParserIterator<A> {
  next(...args: any): IteratorResult<Parser<A>, A>;
}

export type UnaryOp<T> = (a: T) => T;
export type BinaryOp<T> = (a: T, b: T) => T;

export type ParseResult<A> = Result.Result<[next: number, value: A], ParseError>;

export type OperatorDecl<T> =
  | { fixity: "prefix" | "postfix"; parser: Parser<UnaryOp<T>> }
  | {
      fixity: "infix";
      associativity: "left" | "right";
      parser: Parser<BinaryOp<T>>;
    };

export class ParseError extends Data.TaggedError("ParseError")<{
  index: number;
  message?: string;
}> {
  constructor(index: number, message?: string) {
    super({ index, message });
  }

  format(input: string): string {
    const lines = input.split("\n");
    let remaining = this.index;
    let lineNum = 0;
    for (let l = 0; l < lines.length; l++) {
      if (remaining <= lines[l]!.length) {
        lineNum = l;
        break;
      }
      remaining -= lines[l]!.length + 1;
    }
    const col = remaining;
    const line = lines[lineNum];
    const lineLabel = String(lineNum + 1);
    const pad = " ".repeat(lineLabel.length);

    return [
      `Error: ${this.message}`,
      `${pad} ╭─[${lineNum + 1}:${col + 1}]`,
      `${lineLabel} │ ${line}`,
      `${pad} · ${" ".repeat(col)}^`,
      `${pad} ╰──`,
    ].join("\n");
  }
}

export function succeed<A>(next: number, value: A): ParseResult<A> {
  return Result.succeed([next, value]);
}

export function fail<A = never>(index: number, message?: string): Result.Result<A, ParseError> {
  return Result.fail(new ParseError(index, message));
}

export const Prototype = {
  [TypeId]: TypeId,
  ...Pipeable.Prototype,
  [Symbol.iterator](this: Top) {
    return new SingleShotGen(this);
  },
};

export function make<A>(parse: (input: string, index: number) => ParseResult<A>): Parser<A> {
  return Object.assign(Object.create(Prototype), { parse });
}

export const map: {
  <A, B>(self: Parser<A>, fn: (value: A, start: number, end: number) => B): Parser<B>;
  <A, B>(fn: (value: A, start: number, end: number) => B): (self: Parser<A>) => Parser<B>;
} = dual(2, <A, B>(self: Parser<A>, fn: (value: A, start: number, end: number) => B): Parser<B> => {
  return make((input, index) => {
    return Result.flatMap(self.parse(input, index), ([next, value]) =>
      succeed(next, fn(value, index, next)),
    );
  });
});

function skipWSAt(input: string, index: number): number {
  let next = index;
  while (next < input.length) {
    const code = input.charCodeAt(next);
    if (code === 32 || (code >= 9 && code <= 13)) {
      next += 1;
    } else {
      break;
    }
  }
  return next;
}

export const skipWS: Parser<void> = make((input, index) =>
  succeed(skipWSAt(input, index), undefined),
);

export function token<A>(parser: Parser<A>) {
  return make((input, index) => parser.parse(input, skipWSAt(input, index)));
}

export function regex<const G = undefined>(re: RegExp): Parser<RegExpMatchArray & { groups: G }> {
  const sticky = re.sticky ? re : new RegExp(re.source, re.flags + "y");
  return make((input, index) => {
    sticky.lastIndex = index;
    const match = sticky.exec(input);
    if (match === null) {
      return fail(index, `Expected /${re.source}/${re.flags}`);
    }
    return succeed(index + match[0].length, match as any);
  });
}

export function literal<const T extends NonEmptyReadonlyArray<string>>(
  ...literals: T
): Parser<T[number]> {
  const xs = literals.toSorted((a, b) => Math.sign(b.length - a.length));
  const err =
    xs.length > 1 ? `Expected one of ${xs.map((x) => `'${x}'`).join(", ")}` : `Expected '${xs[0]}'`;

  return make((input, index) => {
    for (const lit of xs) {
      if (!input.startsWith(lit, index)) continue;
      return succeed(index + lit.length, lit);
    }
    return fail(index, err);
  });
}

export function literalToken<const T extends NonEmptyReadonlyArray<string>>(...tokens: T) {
  return token(literal(...tokens));
}

/**
 * Like {@link map}, but skips leading whitespace before running `self`, so the
 * `start` handed to `fn` is where the token actually begins rather than where
 * the surrounding parser began looking.
 */
export const mapToken: {
  <A, B>(self: Parser<A>, fn: (value: A, start: number, end: number) => B): Parser<B>;
  <A, B>(fn: (value: A, start: number, end: number) => B): (self: Parser<A>) => Parser<B>;
} = dual(2, <A, B>(self: Parser<A>, fn: (value: A, start: number, end: number) => B): Parser<B> => {
  return token(map(self, fn));
});

const _numRe = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export const number: Parser<number> = make((input, index) => {
  _numRe.lastIndex = index;
  const match = _numRe.exec(input);
  if (match === null) return fail(index, "Expected number");
  return succeed(index + match[0].length, parseFloat(match[0]));
});

const _intRe = /[0-9]+/y;

export const int: Parser<number> = make((input, index) => {
  _intRe.lastIndex = index;
  const match = _intRe.exec(input);
  if (match === null) return fail(index, "Expected number");
  return succeed(index + match[0].length, parseInt(match[0], 10));
});

export function surround<A>(open: Top, parser: Parser<A>, close: Top): Parser<A> {
  return gen(function* () {
    yield* open;
    const out = yield* parser;
    yield* close;
    return out;
  });
}

export function suspend<A>(fn: LazyArg<Parser<A>>): Parser<A> {
  let parser = Option.none<Parser<A>>();
  return make((input, index) =>
    Option.getOrElse(parser, () => {
      const p = fn();
      parser = Option.some(p);
      return p;
    }).parse(input, index),
  );
}

export function tuple<const T extends readonly Top[]>(
  ts: [...T],
): Parser<{
  [P in keyof T]: T[P]["~type.value"];
}> {
  return make<any>((input, index) => {
    const out: unknown[] = [];
    let cursor = index;
    for (const t of ts) {
      const res = t.parse(input, cursor);
      if (Result.isFailure(res)) return res;
      out.push(res.success[1]);
      cursor = res.success[0];
    }

    return succeed(cursor, out);
  });
}

export const isEof = make((input, index) => succeed(index, !(index < input.length)));

export function oneOf<const T extends readonly Top[]>(...ts: [...T]) {
  return make<T[number]["~type.value"]>((input, index) => {
    let furthest = Option.none<Result.Failure<never, ParseError>>();
    for (const t of ts) {
      const res = t.parse(input, index);
      if (Result.isSuccess(res)) return res;
      if (Option.isNone(furthest) || res.failure.index > furthest.value.failure.index) {
        furthest = Option.some(res as Result.Failure<never, ParseError>);
      }
    }
    return Option.getOrElse(furthest, () => fail(index, "Unknown token"));
  });
}

export function choice<A>(ps: NonEmptyReadonlyArray<Parser<A>>): Parser<A> {
  return oneOf(...ps);
}

export function option<A>(p: Parser<A>): Parser<Option.Option<A>> {
  return make((input, index) =>
    Result.match(p.parse(input, index), {
      onSuccess: ([i, v]) => succeed(i, Option.some(v)),
      onFailure: () => succeed(index, Option.none()),
    }),
  );
}

export function sepBy1<A>(separator: Top, parser: Parser<A>): Parser<NonEmptyReadonlyArray<A>> {
  return make<NonEmptyReadonlyArray<A>>((input, index) => {
    const first = parser.parse(input, index);
    if (Result.isFailure(first)) return first as Result.Failure<never, ParseError>;

    const out: [A, ...A[]] = [first.success[1]];
    let cursor = first.success[0];

    while (true) {
      const sep = separator.parse(input, cursor);
      if (Result.isFailure(sep)) break;

      const next = parser.parse(input, sep.success[0]);
      if (Result.isFailure(next)) return next as Result.Failure<never, ParseError>;

      out.push(next.success[1]);
      cursor = next.success[0];
    }

    return succeed(cursor, out);
  });
}

export function sepBy<A>(separator: Top, parser: Parser<A>): Parser<ReadonlyArray<A>> {
  const one = sepBy1(separator, parser);
  return make<ReadonlyArray<A>>((input, index) => {
    const res = one.parse(input, index);
    if (Result.isSuccess(res)) return res;

    return res.failure.index === index ? succeed(index, []) : res;
  });
}

export function gen<A>(fn: () => Generator<Top, A>): Parser<A> {
  return make((input, index) => {
    let cursor = index;

    const it = fn();
    let state = it.next();
    while (!state.done) {
      const res = state.value.parse(input, cursor);
      if (Result.isFailure(res)) {
        return res as Result.Failure<never, ParseError>;
      }
      state = it.next(res.success[1]);
      cursor = res.success[0];
    }

    return succeed(cursor, state.value);
  });
}

export function runToEnd<A>(parser: Parser<A>, input: string): Effect.Effect<A, ParseError> {
  return Effect.fromResult(
    Result.flatMap(parser.parse(input, 0), ([len, value]) => {
      if (len < input.length) {
        return fail(len, "Expected EOF");
      }
      return Result.succeed(value);
    }),
  );
}

export function buildExpressionParser<T>(
  operators: ReadonlyArray<OperatorDecl<T>>,
  termFactory: () => Parser<NoInfer<T>>,
): Parser<T> {
  // earlier in the array binds tighter
  const precAt = (i: number) => operators.length - i;

  const preOps = Array.filterMap(operators, (op, i) => {
    return op.fixity === "prefix"
      ? Result.succeed({ prec: precAt(i), parser: op.parser })
      : Result.failVoid;
  });
  const postOps = Array.filterMap(operators, (op, i) => {
    return op.fixity === "postfix"
      ? Result.succeed({ prec: precAt(i), parser: op.parser })
      : Result.failVoid;
  });
  const binOps = Array.filterMap(operators, (op, i) => {
    const prec = precAt(i);
    return op.fixity === "infix"
      ? Result.succeed({
          prec,
          nextPrec: op.associativity === "left" ? prec + 1 : prec,
          parser: op.parser,
        })
      : Result.failVoid;
  });

  const lazyTerm = suspend(termFactory);
  const parsePrecCache = new Map<number, Parser<T>>();

  function parsePrec(minPrec: number): Parser<T> {
    return mapUpsert(parsePrecCache, minPrec, () => {
      const parsePreOp = make<Option.Option<{ action: UnaryOp<T>; prec: number }>>(
        (input, index) => {
          for (const op of preOps) {
            if (op.prec < minPrec) continue;
            const res = op.parser.parse(input, index);
            if (Result.isFailure(res)) continue;
            return succeed(res.success[0], Option.some({ action: res.success[1], prec: op.prec }));
          }
          return succeed(index, Option.none());
        },
      );

      const parsePostOp = make<Option.Option<UnaryOp<T>>>((input, index) => {
        for (const op of postOps) {
          if (op.prec < minPrec) continue;
          const res = op.parser.parse(input, index);
          if (Result.isFailure(res)) continue;
          return succeed(res.success[0], Option.some(res.success[1]));
        }
        return succeed(index, Option.none());
      });

      const parseBinOp = make<Option.Option<{ action: BinaryOp<T>; nextPrec: number }>>(
        (input, index) => {
          for (const op of binOps) {
            if (op.prec < minPrec) continue;
            const res = op.parser.parse(input, index);
            if (Result.isFailure(res)) continue;
            return succeed(
              res.success[0],
              Option.some({ action: res.success[1], nextPrec: op.nextPrec }),
            );
          }
          return succeed(index, Option.none());
        },
      );

      return gen(function* () {
        const pre = yield* parsePreOp;

        // recurse at the operator's own precedence so prefixes stack (`not not x`)
        // and so anything binding tighter is pulled into the operand
        let lhs: T = Option.isSome(pre)
          ? pre.value.action(yield* parsePrec(pre.value.prec))
          : yield* lazyTerm;

        while (true) {
          const post = yield* parsePostOp;
          if (Option.isNone(post)) break;
          lhs = post.value(lhs);
        }

        while (true) {
          const binOp = yield* parseBinOp;
          if (Option.isNone(binOp)) break;

          const rhs = yield* parsePrec(binOp.value.nextPrec);
          lhs = binOp.value.action(lhs, rhs);
        }

        return lhs;
      });
    });
  }

  return parsePrec(0);
}
