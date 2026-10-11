/**
 * Minimal SSE stream helper for console live endpoints. The gateway
 * already speaks SSE to inference clients; frames are the same wire shape
 * (named `event:`, JSON `data:`) pointed at the dashboard instead, built by
 * the shared `buildSseEventFrame` core so the two layers cannot drift.
 */

export interface SseSender {
  send(event: string, data: unknown): void;
}

/** Register endpoint-specific SSE subscriptions; return their teardown callback. */
export type SseSetup = (sender: SseSender) => () => void;

import { buildSseEventFrame as formatSseFrame } from "../../transport/surface/stream-frame";

export { formatSseFrame };

/**
 * Interval between SSE comment frames.
 *
 * A comment frame is what keeps an idle stream alive through intermediaries:
 * nginx's `proxy_read_timeout` and most load balancers default to 60s, and a
 * live page can easily go longer than that between log lines on a quiet
 * gateway. At 25s the stream was cut by anything stricter — a 30s timeout with
 * a little jitter was enough — and the page then sat frozen until the client
 * noticed. 10s leaves room under every default in common use.
 */
const SSE_HEARTBEAT_MS = 10_000;

/**
 * Console SSE response stream with uniform JSON event encoding, heartbeat,
 * and abort/cancel cleanup. The setup callback runs synchronously at stream
 * start so the initial snapshot is enqueued before the first read.
 */
export function createConsoleSseStream(
  signal: AbortSignal,
  setup: SseSetup,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanupSubscription: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let close: (() => void) | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const sender: SseSender = {
        send(event, data) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(formatSseFrame(event, JSON.stringify(data))));
          } catch {
            close?.();
          }
        },
      };

      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        cleanupSubscription?.();
        try {
          controller.close();
        } catch {
          // Stream may already be closed by the runtime.
        }
      };

      if (signal.aborted) {
        close();
        return;
      }
      cleanupSubscription = setup(sender);
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close?.();
        }
      }, SSE_HEARTBEAT_MS);

      signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      close?.();
    },
  });
}

/** Standard response wrapper for console SSE endpoints. */
export function consoleSseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
