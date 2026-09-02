import { NodeStream } from "@effect/platform-node";
import { Cause, Context, Effect, Layer } from "effect";
import * as find from "empathic/find";
import fg from "fast-glob";

export class FileUtils extends Context.Service<FileUtils>()("@tatr/cli/FileUtils", {
  make: Effect.gen(function* () {
    function glob(source: fg.Pattern | fg.Pattern[], options?: fg.Options) {
      return NodeStream.fromReadable<string>({
        evaluate: () => fg.globStream(source, options),
      });
    }

    function findDir(name: string, options?: find.Options) {
      return Effect.mapError(
        Effect.suspend(() => Effect.fromNullishOr(find.dir(name, options))),
        () => new Cause.NoSuchElementError(`'${name}' not found`),
      );
    }

    function findFile(name: string, options?: find.Options) {
      return Effect.mapError(
        Effect.suspend(() => Effect.fromNullishOr(find.file(name, options))),
        () => new Cause.NoSuchElementError(`'${name}' not found`),
      );
    }

    return {
      findFile,
      findDir,
      glob,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
