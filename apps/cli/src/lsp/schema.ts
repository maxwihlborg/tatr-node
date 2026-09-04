import { Schema } from "effect";

export const Position = Schema.Struct({
  line: Schema.Int,
  character: Schema.Int,
});
export type Position = typeof Position.Type;

export const PositionRange = Schema.Struct({
  start: Position,
  end: Position,
});

/**
 * What the server answers `initialize` with, the one response shape that has
 * to survive encoding
 */
export const InitializeResult = Schema.Struct({
  capabilities: Schema.Struct({
    textDocumentSync: Schema.Struct({
      openClose: Schema.Boolean,
      change: Schema.Int,
    }),
    definitionProvider: Schema.Boolean,
    hoverProvider: Schema.Boolean,
    codeActionProvider: Schema.Boolean,
    completionProvider: Schema.Struct({
      triggerCharacters: Schema.Array(Schema.String),
    }),
  }),
  serverInfo: Schema.Struct({
    name: Schema.String,
    version: Schema.String,
  }),
});

export const Location = Schema.Struct({
  uri: Schema.URLFromString,
  range: PositionRange,
});

export const Hover = Schema.Struct({
  contents: Schema.Struct({
    kind: Schema.Literal("markdown"),
    value: Schema.String,
  }),
});

export const TextEdit = Schema.Struct({
  range: PositionRange,
  newText: Schema.String,
});

export const CompletionItem = Schema.Struct({
  label: Schema.String,
  kind: Schema.Int,
  detail: Schema.String,
  textEdit: TextEdit,
});

export const CompletionList = Schema.Struct({
  isIncomplete: Schema.Boolean,
  items: Schema.Array(CompletionItem),
});

/**
 * The client does the writing: it fills in the task and rewrites the marker as
 * one undoable step. Deliberately no `create`, which would put an empty file on
 * disk behind the editor's back, leaving the buffer unsavable without a bang
 */
export const CodeAction = Schema.Struct({
  title: Schema.String,
  kind: Schema.Literal("quickfix"),
  edit: Schema.Struct({
    documentChanges: Schema.Array(
      Schema.Struct({
        textDocument: Schema.Struct({
          uri: Schema.URLFromString,
          version: Schema.NullOr(Schema.Int),
        }),
        edits: Schema.Array(TextEdit),
      }),
    ),
  }),
});
