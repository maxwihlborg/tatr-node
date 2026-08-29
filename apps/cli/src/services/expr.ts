import { Effect, type Data } from "effect";
import { ParseError } from "../lib/parser.js";

export const Kind = {
  Int: "int",
  Bool: "boolean",
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export type IntExpr = Data.TaggedEnum<{
  Prio: { i: number };
  Int: { value: number; i: number };
}>;

export type BoolExpr = Data.TaggedEnum<{
  Not: { expr: Expr; i: number };
  Tag: { tag: string; i: number };
  And: { lhs: Expr; rhs: Expr; i: number };
  Or: { lhs: Expr; rhs: Expr; i: number };
  LessThan: { lhs: Expr; rhs: Expr; i: number };
  GreaterThan: { lhs: Expr; rhs: Expr; i: number };
  LessThanEquals: { lhs: Expr; rhs: Expr; i: number };
  GreaterThanEquals: { lhs: Expr; rhs: Expr; i: number };
  Equals: { lhs: Expr; rhs: Expr; i: number };
  NotEquals: { lhs: Expr; rhs: Expr; i: number };
}>;

export type Expr = IntExpr | BoolExpr;

export const _kindOf = {
  Prio: Kind.Int,
  Int: Kind.Int,
  Not: Kind.Bool,
  Tag: Kind.Bool,
  And: Kind.Bool,
  Or: Kind.Bool,
  LessThan: Kind.Bool,
  GreaterThan: Kind.Bool,
  LessThanEquals: Kind.Bool,
  GreaterThanEquals: Kind.Bool,
  Equals: Kind.Bool,
  NotEquals: Kind.Bool,
} as const satisfies {
  [P in IntExpr["_tag"]]: (typeof Kind)["Int"];
} & {
  [P in BoolExpr["_tag"]]: (typeof Kind)["Bool"];
};

export function kindOf(expr: Expr) {
  return _kindOf[expr._tag];
}

export type CompOp = "lt" | "gt" | "lte" | "gte" | "eq" | "neq" | "and" | "or";

export type Op = Data.TaggedEnum<{
  Prio: {};
  Int: { value: number };
  Tag: { tag: string };
  Not: {};
  Comp: { op: CompOp };
}>;

export const ExprOp = {
  And: "and",
  Or: "or",
  LessThan: "lt",
  GreaterThan: "gt",
  LessThanEquals: "lte",
  GreaterThanEquals: "gte",
  Equals: "eq",
  NotEquals: "neq",
} as const satisfies Partial<Record<Expr["_tag"], CompOp>>;

export function compOp(expr: Extract<Expr, { _tag: keyof typeof ExprOp }>) {
  return ExprOp[expr._tag];
}

export function isKind(expr: Expr, kind: Kind) {
  return kindOf(expr) === kind;
}

export function expectKind(expr: Expr, kind: Kind) {
  return Effect.filterOrFail(
    Effect.succeed(expr),
    (a) => isKind(a, kind),
    (a) => new ParseError(a.i, `Expected '${kind}' expr, got '${kindOf(a)}' expr`),
  );
}
