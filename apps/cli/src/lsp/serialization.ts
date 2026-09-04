import { Layer, Predicate } from "effect";
import { RpcSerialization } from "effect/unstable/rpc";

const TERMINATOR = new Uint8Array([13, 10, 13, 10]);
const CONTENT_LENGTH = /content-length:\s*(\d+)/i;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(head: Uint8Array, tail: Uint8Array) {
  const out = new Uint8Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
}

function indexOfTerminator(buffer: Uint8Array) {
  outer: for (let i = 0; i + TERMINATOR.length <= buffer.length; i++) {
    for (let j = 0; j < TERMINATOR.length; j++) {
      if (buffer[i + j] !== TERMINATOR[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

/**
 * The framing every LSP client speaks: `Content-Length: <bytes>` headers, a
 * blank line, then that many bytes of JSON-RPC. The message shapes themselves
 * are left to the built in JSON-RPC serialization, which is what `ndJsonRpc`
 * does with its newlines.
 */
export function lspRpc(): RpcSerialization.RpcSerialization["Service"] {
  return RpcSerialization.RpcSerialization.of({
    contentType: "application/vscode-jsonrpc; charset=utf-8",
    includesFraming: true,
    makeUnsafe: () => {
      const messages = RpcSerialization.jsonRpc().makeUnsafe();
      let buffer = new Uint8Array(0);

      return {
        decode: (data) => {
          buffer = concat(buffer, typeof data === "string" ? encoder.encode(data) : data);

          const decoded: Array<unknown> = [];

          for (;;) {
            const headerEnd = indexOfTerminator(buffer);
            if (headerEnd < 0) {
              break;
            }

            const bodyStart = headerEnd + TERMINATOR.length;
            const header = CONTENT_LENGTH.exec(decoder.decode(buffer.subarray(0, headerEnd)));

            if (!header) {
              // nothing to frame by, drop the headers and look for the next set
              buffer = buffer.subarray(bodyStart);
              continue;
            }

            const length = Number(header[1]);
            if (buffer.length < bodyStart + length) {
              break;
            }

            decoded.push(
              ...messages.decode(decoder.decode(buffer.subarray(bodyStart, bodyStart + length))),
            );

            buffer = buffer.subarray(bodyStart + length);
          }

          return decoded;
        },
        encode: (response) => {
          // a request without an id is a notification, which must go
          // unanswered, but the server still hands us an exit for it
          if (Predicate.hasProperty(response, "requestId") && response.requestId === "") {
            return undefined;
          }

          const encoded = messages.encode(response);
          if (encoded === undefined) {
            return undefined;
          }

          const body = typeof encoded === "string" ? encoder.encode(encoded) : encoded;

          return concat(encoder.encode(`Content-Length: ${body.length}\r\n\r\n`), body);
        },
      };
    },
  });
}

export const layerLspRpc = Layer.sync(RpcSerialization.RpcSerialization, () => lspRpc());
