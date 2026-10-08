/**
 * Isolated mock upstream for the Rikka E2E harness.
 *
 * This is a real HTTP server on loopback that speaks the three upstream wire
 * families the gateway codecs implement (OpenAI chat, OpenAI Responses,
 * Anthropic Messages) plus model listing. It exists so the harness can assert
 * what the *production adapter* serialized and how the *production parser*
 * decoded a response — evidence a stub adapter cannot produce, because a stub
 * skips both.
 *
 * Every response is deterministic: no randomness, no clock-derived bodies, no
 * network calls out. Fault behaviors are selected by request content or by an
 * explicit scenario key, never by wall-clock timing, so a re-run reproduces
 * the same transcript byte for byte.
 *
 * The server records each call with the fields the assertions need (wire
 * family, path, auth header shape, parsed body, raw byte length) and exposes
 * `/__mock/*` control endpoints that are never reachable through the gateway.
 */
import { createHash } from "node:crypto";
import { isRecord } from "../../src/protocol/primitives";

/** Wire families the mock can answer. */
export type MockWire = "chat" | "responses" | "messages" | "unknown";

/** One recorded upstream call. */
export interface MockCall {
  readonly seq: number;
  readonly method: string;
  readonly path: string;
  readonly wire: MockWire;
  readonly authHeader: "authorization" | "x-api-key" | "none";
  readonly body: unknown;
  readonly rawBodyBytes: number;
  readonly stream: boolean;
  readonly model: string | undefined;
  /** True when the client disconnected before the mock finished writing. */
  readonly clientAborted: boolean;
}

/** Mutable form the handler records into; the public view is `MockCall`. */
interface RecordedCall {
  seq: number;
  method: string;
  path: string;
  wire: MockWire;
  authHeader: MockCall["authHeader"];
  body: unknown;
  rawBodyBytes: number;
  stream: boolean;
  model: string | undefined;
  clientAborted: boolean;
}

/** Behaviors the mock can be told to produce, keyed by the model id. */
export type MockBehavior =
  | "ok"
  | "ok-tool"
  | "ok-reasoning"
  | "ok-utf8-split"
  | "ok-usage"
  | "fault-401"
  | "fault-429"
  | "fault-500"
  | "fault-malformed-json"
  | "fault-reset"
  | "fault-slow"
  | "fault-partial-stream"
  | "fault-stream-mid-error";

const DEFAULT_BEHAVIOR: MockBehavior = "ok";

/**
 * Deterministic text per behavior. Kept short so a trace stays readable and
 * the token accounting in assertions is exact rather than approximate.
 */
const TEXT: Readonly<Record<string, string>> = {
  ok: "mock-ok",
  "ok-tool": "mock-tool",
  "ok-reasoning": "mock-reasoning",
  "ok-utf8-split": "日本語テキスト",
  "ok-usage": "mock-usage",
};

interface MockOptions {
  /** Behaviors keyed by exact model id; unlisted models answer `ok`. */
  readonly behaviors?: Readonly<Record<string, MockBehavior>>;
  /** Milliseconds to hold a `fault-slow` response before answering. */
  readonly slowMs?: number;
}

function classifyWire(path: string): MockWire {
  if (path.includes("/chat/completions")) return "chat";
  if (path.includes("/responses/compact")) return "responses";
  if (path.includes("/responses")) return "responses";
  if (path.includes("/messages")) return "messages";
  return "unknown";
}

function authShape(request: Request): MockCall["authHeader"] {
  if (request.headers.get("authorization") !== null) return "authorization";
  if (request.headers.get("x-api-key") !== null) return "x-api-key";
  return "none";
}

function sse(frames: readonly string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/**
 * Emits `text` split across chunk boundaries that land inside a multi-byte
 * UTF-8 sequence, so the gateway's incremental decoder is exercised on a
 * real socket rather than a synthetic buffer.
 */
function sseUtf8Split(wire: MockWire, model: string, text: string): Response {
  const encoder = new TextEncoder();
  const frames: Uint8Array[] = [];
  const body = JSON.stringify(
    wire === "chat"
      ? {
          id: "chatcmpl-fixture",
          object: "chat.completion.chunk",
          created: 1_700_000_000,
          model,
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        }
      : {
          type: "response.output_text.delta",
          sequence_number: 0,
          delta: text,
        },
  );
  const prefix = encoder.encode(wire === "responses" ? "event: response.output_text.delta\ndata: " : "data: ");
  const suffix = encoder.encode("\n\n");
  const payload = encoder.encode(body);
  // Split two bytes before the payload's final byte: for a body ending in a
  // multi-byte character this lands inside it, which is the case under test.
  const cut = Math.max(prefix.length, payload.length - 2);
  const first = new Uint8Array(prefix.length + cut);
  first.set(prefix);
  first.set(payload.subarray(0, cut), prefix.length);
  const second = new Uint8Array(payload.length - cut + suffix.length);
  second.set(payload.subarray(cut));
  second.set(suffix, payload.length - cut);
  frames.push(first, second);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

function chatJson(model: string, text: string, usage: boolean): unknown {
  return {
    id: "chatcmpl-fixture",
    object: "chat.completion",
    created: 1_700_000_000,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    ...(usage
      ? {
          usage: {
            prompt_tokens: 7,
            completion_tokens: 2,
            total_tokens: 9,
            prompt_tokens_details: { cached_tokens: 3 },
            completion_tokens_details: { reasoning_tokens: 1 },
          },
        }
      : {}),
  };
}

function chatToolJson(model: string): unknown {
  return {
    id: "chatcmpl-fixture-tool",
    object: "chat.completion",
    created: 1_700_000_000,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_fixture_1",
              type: "function",
              function: { name: "lookup", arguments: '{"q":"mock"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
  };
}

function chatReasoningJson(model: string): unknown {
  return {
    id: "chatcmpl-fixture-reasoning",
    object: "chat.completion",
    created: 1_700_000_000,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "mock-reasoning",
          reasoning_content: "mock-thought",
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };
}

function chatStream(model: string, text: string, includeUsage: boolean): Response {
  const frames = [
    `data: ${JSON.stringify({
      id: "chatcmpl-fixture",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-fixture",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model,
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-fixture",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
  ];
  if (includeUsage) {
    frames.push(
      `data: ${JSON.stringify({
        id: "chatcmpl-fixture",
        object: "chat.completion.chunk",
        created: 1_700_000_000,
        model,
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      })}\n\n`,
    );
  }
  frames.push("data: [DONE]\n\n");
  return sse(frames);
}

function chatToolStream(model: string): Response {
  return sse([
    `data: ${JSON.stringify({
      id: "chatcmpl-fixture-tool",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_fixture_1",
                type: "function",
                function: { name: "lookup", arguments: '{"q":' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-fixture-tool",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '"mock"}' } }] },
          finish_reason: null,
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-fixture-tool",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}

function responsesJson(model: string, text: string, usage: boolean): unknown {
  return {
    id: "resp_fixture",
    object: "response",
    created_at: 1_700_000_000,
    status: "completed",
    model,
    output: [
      {
        type: "message",
        id: "msg_fixture",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    ...(usage
      ? {
          usage: {
            input_tokens: 7,
            output_tokens: 2,
            total_tokens: 9,
            input_tokens_details: { cached_tokens: 3 },
            output_tokens_details: { reasoning_tokens: 1 },
          },
        }
      : {}),
  };
}

function responsesStream(model: string, text: string, usage: boolean): Response {
  const frames = [
    `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      sequence_number: 0,
      response: {
        id: "resp_fixture",
        object: "response",
        created_at: 1_700_000_000,
        status: "in_progress",
        model,
        output: [],
      },
    })}\n\n`,
    `event: response.output_item.added\ndata: ${JSON.stringify({
      type: "response.output_item.added",
      sequence_number: 1,
      output_index: 0,
      item: { id: "msg_fixture", type: "message", role: "assistant", status: "in_progress", content: [] },
    })}\n\n`,
    `event: response.content_part.added\ndata: ${JSON.stringify({
      type: "response.content_part.added",
      sequence_number: 2,
      item_id: "msg_fixture",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: "response.output_text.delta",
      sequence_number: 3,
      item_id: "msg_fixture",
      output_index: 0,
      content_index: 0,
      delta: text,
    })}\n\n`,
    `event: response.output_text.done\ndata: ${JSON.stringify({
      type: "response.output_text.done",
      sequence_number: 4,
      item_id: "msg_fixture",
      output_index: 0,
      content_index: 0,
      text,
    })}\n\n`,
    `event: response.output_item.done\ndata: ${JSON.stringify({
      type: "response.output_item.done",
      sequence_number: 5,
      output_index: 0,
      item: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      sequence_number: 6,
      response: responsesJson(model, text, usage),
    })}\n\n`,
  ];
  return sse(frames);
}

function messagesJson(model: string, text: string, usage: boolean): unknown {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    ...(usage
      ? { usage: { input_tokens: 7, output_tokens: 2, cache_read_input_tokens: 3 } }
      : {}),
  };
}

function messagesStream(model: string, text: string, usage: boolean): Response {
  const frames = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 0 },
      },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      ...(usage ? { usage: { output_tokens: 2 } } : {}),
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
  return sse(frames);
}

function messagesToolJson(model: string): unknown {
  return {
    id: "msg_fixture_tool",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "tool_use", id: "call_fixture_1", name: "lookup", input: { q: "mock" } }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 9, output_tokens: 4 },
  };
}

/** A Responses prelude with no renderable content, used for retry scenarios. */
function responsesEmptyPreludeStream(model: string): Response {
  return sse([
    `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      sequence_number: 0,
      response: {
        id: "resp_fixture",
        object: "response",
        created_at: 1_700_000_000,
        status: "in_progress",
        model,
        output: [],
      },
    })}\n\n`,
  ]);
}

/**
 * Boots the mock on an ephemeral loopback port. The caller owns the returned
 * `stop()`, and must call it before removing the run root.
 */
export function startMockUpstream(options: MockOptions = {}): {
  readonly port: number;
  readonly url: string;
  readonly calls: readonly MockCall[];
  readonly stop: () => Promise<void>;
  /** Clears recorded calls so a scenario's assertions count only its own. */
  readonly reset: () => void;
  /**
   * Replaces the behavior map. Needed because the model ids are only known
   * after the console API registers them, and the mock must already be
   * listening when those provider rows are created.
   */
  readonly setBehaviors: (next: Readonly<Record<string, MockBehavior>>) => void;
} {
  let behaviors = options.behaviors ?? {};
  const slowMs = options.slowMs ?? 250;
  const calls: RecordedCall[] = [];
  let seq = 0;
  const stopped = Promise.withResolvers<void>();

  const record = (call: Omit<RecordedCall, "seq">): RecordedCall => {
    const entry: RecordedCall = { seq: (seq += 1), ...call };
    calls.push(entry);
    return entry;
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 30,
    async fetch(request) {
      const url = new URL(request.url);
      // Control surface. Only reachable directly; the gateway never proxies it.
      if (url.pathname === "/__mock/calls") {
        return Response.json({ calls });
      }
      if (url.pathname === "/__mock/reset") {
        calls.length = 0;
        seq = 0;
        return Response.json({ ok: true });
      }
      if (url.pathname === "/__mock/health") {
        return Response.json({ ok: true });
      }

      const wire = classifyWire(url.pathname);
      const raw = await request.text();
      let body: unknown = undefined;
      try {
        body = raw.length === 0 ? undefined : JSON.parse(raw);
      } catch {
        body = raw;
      }
      const model =
        isRecord(body) && "model" in body && typeof body["model"] === "string"
          ? body["model"]
          : undefined;
      const behavior: MockBehavior = (model !== undefined ? behaviors[model] : undefined) ?? DEFAULT_BEHAVIOR;
      const streamRequested = isRecord(body) && body["stream"] === true;

      const entry = record({
        method: request.method,
        path: url.pathname,
        wire,
        authHeader: authShape(request),
        body,
        rawBodyBytes: Buffer.byteLength(raw, "utf8"),
        stream: streamRequested,
        model,
        clientAborted: false,
      });
      // The gateway aborts its outbound fetch when the *client* disconnects, so
      // this signal firing is the mock's evidence that cancellation propagated
      // through the whole pipeline. It is recorded, never thrown on.
      request.signal.addEventListener("abort", () => {
        entry.clientAborted = true;
      });

      if (request.method === "GET" && url.pathname.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: [{ id: model ?? "fixture-model" }],
        });
      }

      if (behavior === "fault-401") {
        // Echoes the rejected credential, which is exactly the leak surface a
        // caller must not be able to read back through the gateway.
        const presented =
          request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "";
        return Response.json(
          { error: { type: "invalid_api_key", message: `incorrect api key provided: ${presented}` } },
          { status: 401 },
        );
      }
      if (behavior === "fault-429") {
        return Response.json(
          { error: { type: "rate_limit_error", message: "mock upstream rate limit" } },
          { status: 429, headers: { "retry-after": "3" } },
        );
      }
      if (behavior === "fault-500") {
        return Response.json(
          { error: { type: "server_error", message: "mock upstream failure" } },
          { status: 500 },
        );
      }
      if (behavior === "fault-malformed-json") {
        return new Response('{"choices":[{"delta":{"content":"trunc', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (behavior === "fault-reset") {
        // Closing without a body makes the client observe a transport reset
        // rather than an HTTP error.
        return new Response(null, { status: 200, headers: { "content-type": "application/json" } });
      }
      if (behavior === "fault-slow") {
        const gate = Promise.withResolvers<void>();
        setTimeout(gate.resolve, slowMs);
        await gate.promise;
      }
      if (behavior === "fault-stream-mid-error") {
        return sse([
          `data: ${JSON.stringify({
            id: "chatcmpl-fixture",
            object: "chat.completion.chunk",
            created: 1_700_000_000,
            model,
            choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: null }],
          })}\n\n`,
          `data: ${JSON.stringify({ error: { type: "server_error", message: "mock mid-stream failure" } })}\n\n`,
        ]);
      }

      const text = TEXT[behavior] ?? TEXT.ok ?? "mock-ok";
      if (streamRequested) {
        if (behavior === "fault-partial-stream") {
          // Headers plus one chunk, then a close with no terminal event: the
          // gateway must surface a truncation rather than a success.
          return sse([
            `data: ${JSON.stringify({
              id: "chatcmpl-fixture",
              object: "chat.completion.chunk",
              created: 1_700_000_000,
              model,
              choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }],
            })}\n\n`,
          ]);
        }
        if (behavior === "ok-utf8-split") return sseUtf8Split(wire, model ?? "", text);
        if (wire === "responses") {
          return behavior === "ok-tool"
            ? responsesStream(model ?? "", text, false)
            : responsesStream(model ?? "", text, behavior === "ok-usage");
        }
        if (wire === "messages") return messagesStream(model ?? "", text, behavior === "ok-usage");
        if (behavior === "ok-tool") return chatToolStream(model ?? "");
        // Chat's usage chunk is opt-in on the *client* request; the provider's
        // own `streaming_usage_mode` only controls the upstream opt-in, so the
        // mock answers with usage whenever it was asked for it.
        const includeUsage =
          isRecord(body) &&
          isRecord(body["stream_options"]) &&
          body["stream_options"]["include_usage"] === true;
        return chatStream(model ?? "", text, includeUsage);
      }

      if (wire === "responses") return Response.json(responsesJson(model ?? "", text, behavior === "ok-usage"));
      if (wire === "messages") {
        return Response.json(
          behavior === "ok-tool" ? messagesToolJson(model ?? "") : messagesJson(model ?? "", text, behavior === "ok-usage"),
        );
      }
      if (behavior === "ok-tool") return Response.json(chatToolJson(model ?? ""));
      if (behavior === "ok-reasoning") return Response.json(chatReasoningJson(model ?? ""));
      return Response.json(chatJson(model ?? "", text, behavior === "ok-usage"));
    },
  });

  const port = server.port;
  if (port === undefined) throw new Error("mock upstream failed to bind an ephemeral port");

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    get calls() {
      return calls;
    },
    stop: async () => {
      await server.stop(true);
      stopped.resolve();
      await stopped.promise;
    },
    reset: () => {
      calls.length = 0;
      seq = 0;
    },
    setBehaviors: (next) => {
      behaviors = next;
    },
  };
}

/**
 * Stable digest of a recorded call's serialized body. Used to assert that the
 * adapter's serialization is byte-identical across runs and across stores.
 */
export function bodyDigest(call: MockCall): string {
  return createHash("sha256").update(JSON.stringify(call.body ?? null)).digest("hex").slice(0, 16);
}

/**
 * The Responses-prelude case: a first response with no renderable content,
 * which the streaming owner may legitimately retry once. Kept separate from
 * the general behavior map so a scenario opts in explicitly.
 */
export function emptyPreludeResponse(model: string): Response {
  return responsesEmptyPreludeStream(model);
}
