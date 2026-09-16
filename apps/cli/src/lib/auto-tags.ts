/** A path prefix to the tags a task made from under it carries. */
export class AutoTags {
  constructor(readonly rules: Record<string, ReadonlyArray<string>>) {}

  get isEmpty() {
    return Object.keys(this.rules).length === 0;
  }
}
