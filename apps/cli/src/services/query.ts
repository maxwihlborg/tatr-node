import { Data, Effect, Option, Order, Predicate } from "effect";
import type { NonEmptyArray, NonEmptyReadonlyArray } from "effect/Array";
import { dual } from "effect/Function";
import { unreachable } from "../lib/functions.js";
import * as P from "../lib/parser.js";
import type { Task } from "../schema.js";
import * as Expr from "./expr.js";

export class CompileError extends Data.TaggedError("CompileError")<{
  input: string;
  message: string;
}> {}

export function normalize(query: string | readonly string[], sep: string): string {
  return (Predicate.isString(query) ? query : query.join(sep)).trim().toLowerCase();
}

const exprParser: P.Parser<Expr.Expr> = P.buildExpressionParser(
  [
    {
      fixity: "infix",
      associativity: "left",
      parser: P.mapToken(
        P.literal(
          "!=",
          "<",
          "<=",
          "==",
          ">",
          ">=",
          "eq",
          "gt",
          "gte",
          "is",
          "isnt",
          "lt",
          "lte",
          "neq",
        ),
        (a, i) => (lhs, rhs) => {
          switch (a) {
            case ">":
            case "gt":
              return Expr.Expr.GreaterThan({ lhs, rhs, i });
            case "<":
            case "lt":
              return Expr.Expr.LessThan({ lhs, rhs, i });
            case ">=":
            case "gte":
              return Expr.Expr.GreaterThanEquals({ lhs, rhs, i });
            case "<=":
            case "lte":
              return Expr.Expr.LessThanEquals({ lhs, rhs, i });
            case "==":
            case "eq":
            case "is":
              return Expr.Expr.Equals({ lhs, rhs, i });
            case "!=":
            case "neq":
            case "isnt":
              return Expr.Expr.NotEquals({ lhs, rhs, i });
          }
        },
      ),
    },
    {
      fixity: "prefix",
      parser: P.mapToken(P.literal("not", "!"), (_, i) => (expr) => Expr.Expr.Not({ expr, i })),
    },
    {
      fixity: "infix",
      associativity: "left",
      parser: P.mapToken(
        P.literal("and", "&&", "&"),
        (_, i) => (lhs, rhs) => Expr.Expr.And({ lhs, rhs, i }),
      ),
    },
    {
      fixity: "infix",
      associativity: "left",
      parser: P.mapToken(
        P.literal("or", "||", "|"),
        (_, i) => (lhs, rhs) => Expr.Expr.Or({ lhs, rhs, i }),
      ),
    },
  ],
  () =>
    P.choice([
      P.surround(P.literalToken("("), exprParser, P.literalToken(")")),
      P.surround(P.literalToken("["), exprParser, P.literalToken("]")),
      P.mapToken(P.literal("priority", "prio"), (_, i) => Expr.Expr.Prio({ i })),
      P.mapToken(P.int, (value, i) => Expr.Expr.Int({ value, i })),
      P.mapToken(P.regex(/[.:][a-z0-9_-]+/), (tag, i) =>
        Expr.Expr.Tag({ tag: tag[0].slice(1), i }),
      ),
    ]),
);

const taskOrderParser = P.map(
  P.sepBy1(
    P.literalToken(","),
    P.buildExpressionParser<Order.Order<Task>>(
      [{ fixity: "prefix", parser: P.mapToken(P.literal("-"), () => (ord) => Order.flip(ord)) }],
      () =>
        P.mapToken(
          P.literal(
            "btime",
            "created",
            "id",
            "mod",
            "modified",
            "mtime",
            "prio",
            "priority",
            "size",
            "tags",
            "title",
          ),
          (facet) => {
            switch (facet) {
              case "title":
                return Order.mapInput(Order.String, (n) => n.info.title.toLowerCase());
              case "tags":
                return Order.mapInput(Order.Number, (n) => n.info.tags.length);
              case "mod":
              case "mtime":
              case "modified":
                return Order.mapInput(Option.makeOrder(Order.Date), (n) => n.stat.mtime);
              case "btime":
              case "created":
                return Order.mapInput(Option.makeOrder(Order.Date), (n) => n.stat.birthtime);
              case "size":
                return Order.mapInput(Order.BigInt, (n) => n.stat.size);
              case "id":
                return Order.mapInput(Order.String, (n) => n.id);
              case "prio":
              case "priority":
                return Order.mapInput(Order.Number, (n) => n.info.priority);
              default:
                unreachable(facet);
            }
          },
        ),
    ),
  ),
  (xs) => Order.combineAll(xs),
);

function interpret(root: Expr.Expr): Effect.Effect<NonEmptyReadonlyArray<Expr.Op>, P.ParseError> {
  const step2: (
    acc: Expr.Op[],
    expr: Expr.Expr,
  ) => Effect.Effect<NonEmptyArray<Expr.Op>, P.ParseError> = Effect.fnUntraced(
    function* (acc, expr) {
      switch (expr._tag) {
        case "Prio":
        case "Int":
        case "Tag": {
          acc.push(expr);

          break;
        }
        case "Not": {
          const a = yield* Expr.expectKind(expr.expr, Expr.Kind.Bool);

          yield* step2(acc, a);
          acc.push(Expr.Op.Not());

          break;
        }
        case "And":
        case "Or": {
          const a = yield* Expr.expectKind(expr.lhs, Expr.Kind.Bool);
          const b = yield* Expr.expectKind(expr.rhs, Expr.Kind.Bool);

          yield* step2(acc, a);
          yield* step2(acc, b);
          acc.push(Expr.Op.Comp({ op: Expr.compOp(expr) }));

          break;
        }
        case "LessThan":
        case "GreaterThan":
        case "LessThanEquals":
        case "GreaterThanEquals": {
          const a = yield* Expr.expectKind(expr.lhs, Expr.Kind.Int);
          const b = yield* Expr.expectKind(expr.rhs, Expr.Kind.Int);

          yield* step2(acc, a);
          yield* step2(acc, b);
          acc.push(Expr.Op.Comp({ op: Expr.compOp(expr) }));

          break;
        }
        case "Equals":
        case "NotEquals": {
          const a = expr.lhs;
          const b = yield* Expr.expectKind(expr.rhs, Expr.kindOf(a));

          yield* step2(acc, a);
          yield* step2(acc, b);
          acc.push(Expr.Op.Comp({ op: Expr.compOp(expr) }));

          break;
        }
        default: {
          unreachable(expr);
        }
      }
      return acc as NonEmptyArray<Expr.Op>;
    },
  );

  return Effect.flatMap(Expr.expectKind(root, Expr.Kind.Bool), (a) => step2([], a));
}

export const filter: {
  (self: Task, ops: NonEmptyReadonlyArray<Expr.Op>): boolean;
  (ops: NonEmptyReadonlyArray<Expr.Op>): (self: Task) => boolean;
} = dual(2, (self: Task, ops: NonEmptyReadonlyArray<Expr.Op>): boolean => {
  const stack: number[] = [];
  for (const op of ops) {
    switch (op._tag) {
      case "Prio": {
        stack.push(self.info.priority);
        break;
      }
      case "Int": {
        stack.push(op.value);
        break;
      }
      case "Bool": {
        stack.push(op.value ? 1 : 0);
        break;
      }
      case "Tag": {
        stack.push(self.info.tags.includes(op.tag) ? 1 : 0);
        break;
      }
      case "Closed": {
        stack.push(self.info.closed ? 1 : 0);
        break;
      }
      case "Not": {
        stack.push(stack.pop() ? 0 : 1);
        break;
      }
      case "Comp": {
        const b = stack.pop();
        const a = stack.pop();
        if (a == null || b == null) {
          throw new Error("unreachable");
        }

        switch (op.op) {
          case "lt":
            stack.push(a < b ? 1 : 0);
            break;
          case "gt":
            stack.push(a > b ? 1 : 0);
            break;
          case "lte":
            stack.push(a <= b ? 1 : 0);
            break;
          case "gte":
            stack.push(a >= b ? 1 : 0);
            break;
          case "eq":
            stack.push(a === b ? 1 : 0);
            break;
          case "neq":
            stack.push(a !== b ? 1 : 0);
            break;
          case "and":
            stack.push(a && b ? 1 : 0);
            break;
          case "or":
            stack.push(a || b ? 1 : 0);
            break;
          default: {
            unreachable(op.op);
          }
        }
        break;
      }
      default: {
        unreachable(op);
      }
    }
  }

  return Boolean(stack.pop());
});

export function parseQuery(query: string | readonly string[]) {
  return P.runToEnd(exprParser, normalize(query, " "));
}

export function compileOrder(order: string | readonly string[]) {
  const input = normalize(order, ", ");
  return Effect.mapError(
    P.runToEnd(taskOrderParser, input),
    (err) =>
      new CompileError({
        message: err.format(input),
        input: input,
      }),
  );
}

export function compileQuery(query: string | readonly string[]) {
  const input = normalize(query, " ");
  return Effect.mapError(
    Effect.flatMap(P.runToEnd(exprParser, input), (ast) => interpret(ast)),
    (err) =>
      new CompileError({
        message: err.format(input),
        input: input,
      }),
  );
}
