import { CompletionList, PositionRange } from "./schema";

// The client sends whole documents on open and deltas on change
export const INCREMENTAL_SYNC = 2;
// 18 is `Reference`, the kind clients render for a pointer to something else
export const REFERENCE_ITEM = 18;

export const EMPTY_COMPLETION = CompletionList.make({
  isIncomplete: false,
  items: [],
});

export const TASK_START = PositionRange.make({
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
});
