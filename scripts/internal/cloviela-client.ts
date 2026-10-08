/**
 * HTTP client and evidence recorder for the Rikka E2E harness.
 *
 * Every request in the matrix goes through {@link HarnessClient} so that one
 * place owns cookie handling, CSRF echoing, request tracing and evidence
 * capture. The recorder keeps raw bytes only for sanitized excerpts: evidence
 * must prove what happened without shipping a credential.
 */
import { createHash } from "node:crypto";

/** One HTTP exchange as it will appear in evidence. */
export interface Exchange {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly contentType: string | undefined;
  /** Redacted excerpt of the response body, bounded in size. */
  readonly bodyExcerpt: string;
  /** Byte length of the true body, before excerpting. */
  readonly bodyBytes: number;
  readonly setCookieNames: readonly string[];
  readonly startedAt: number;
  readonly durationMs: number;
  /** SSE frames observed, when the response was an event stream. */
  readonly sseEvents?: readonly string[];
  /** True when the client aborted the request itself. */
  readonly aborted?: boolean;
}

/**
 * Values that must never reach evidence. The list is intentionally blunt:
 * anything matching is replaced wholesale, so a new credential format cannot
 * slip through by being unrecognized.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b[0-9a-f]{64}\b/gi,
  /\b(?:password|secret|api[-_]?key|token|credential)\b"?\s*[:=]\s*"?[^\s",;}]{4,}/gi,
];

/** Replaces every credential-shaped substring with a fixed marker. */
export function sanitize(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

const EXCERPT_LIMIT = 2_048;

function excerpt(text: string): string {
  const sanitized = sanitize(text);
  return sanitized.length <= EXCERPT_LIMIT
    ? sanitized
    : `${sanitized.slice(0, EXCERPT_LIMIT)}…[truncated ${sanitized.length - EXCERPT_LIMIT} chars]`;
}

function cookieNames(response: Response): readonly string[] {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((entry) => entry.slice(0, entry.indexOf("=")));
}

interface RequestOptions {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  /** Raw body for the cases that must send bytes the JSON encoder would alter. */
  readonly rawBody?: string;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sends the CSRF header using the stored cookie. Defaults to true for mutations. */
  readonly csrf?: boolean;
  /** Reads the response as SSE and records the frame types it observed. */
  readonly stream?: boolean;
  /** Aborts the request after this many milliseconds, recording the abort. */
  readonly abortAfterMs?: number;
  /** Aborts once the Nth SSE frame arrives, for mid-stream cancellation. */
  readonly abortAfterFrames?: number;
  readonly expectedStatus?: number;
}

/**
 * Cookies are stored as a name→value map rather than a raw header so the
 * client can echo the CSRF cookie into `x-csrf-token`, which is the real
 * double-submit contract the browser dashboard uses.
 */
export class HarnessClient {
  private readonly cookies = new Map<string, string>();
  private readonly exchanges: Exchange[] = [];

  constructor(private readonly origin: string) {}

  get evidence(): readonly Exchange[] {
    return this.exchanges;
  }

  /** Seeds a cookie directly, for the scenarios that construct a stale session. */
  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  cookieValue(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  async request(options: RequestOptions): Promise<{ exchange: Exchange; response: Response; text: string }> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    const cookieHeader = this.cookieHeader();
    if (cookieHeader !== undefined) headers["cookie"] = cookieHeader;
    if (options.body !== undefined && options.rawBody === undefined) {
      headers["content-type"] = options.contentType ?? "application/json";
    } else if (options.rawBody !== undefined) {
      headers["content-type"] = options.contentType ?? "application/json";
    }
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(options.method.toUpperCase());
    const shouldSendCsrf = options.csrf ?? isMutation;
    if (shouldSendCsrf) {
      const csrf = this.cookies.get("csrf_token");
      if (csrf !== undefined) headers["x-csrf-token"] = csrf;
    }

    const controller = new AbortController();
    let aborted = false;
    const abort = (): void => {
      aborted = true;
      controller.abort();
    };
    if (options.abortAfterMs !== undefined) setTimeout(abort, options.abortAfterMs);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.origin}${options.path}`, {
        method: options.method,
        headers,
        ...(options.rawBody !== undefined
          ? { body: options.rawBody }
          : options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (error) {
      const exchange: Exchange = {
        label: options.label,
        method: options.method,
        path: options.path,
        status: 0,
        requestId: undefined,
        contentType: undefined,
        bodyExcerpt: excerpt(String(error)),
        bodyBytes: 0,
        setCookieNames: [],
        startedAt,
        durationMs: Date.now() - startedAt,
        aborted,
      };
      this.exchanges.push(exchange);
      throw error;
    }

    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const separator = entry.indexOf("=");
      const name = entry.slice(0, separator);
      const value = entry.slice(separator + 1, entry.indexOf(";") < 0 ? undefined : entry.indexOf(";"));
      // An empty value with Max-Age=0 is the clear operation; honor it.
      if (/max-age=0/i.test(entry)) this.cookies.delete(name);
      else if (value.length > 0) this.cookies.set(name, value);
    }

    let text = "";
    let sseEvents: string[] | undefined;
    if (options.stream === true && response.body !== null) {
      const events: string[] = [];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      /**
       * Every frame consumed, in arrival order. `buffer` alone cannot answer
       * "what did the stream say": the loop slices each frame out of it, so
       * whatever is left is only the trailing partial frame. Asserting on that
       * tail made the terminal-event check look for `finish_reason` in an
       * empty string and fail every streaming case while the gateway was
       * streaming correctly.
       */
      let received = "";
      let frames = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const decoded = decoder.decode(chunk.value, { stream: true });
          buffer += decoded;
          received += decoded;
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const eventName = /^event: (.+)$/m.exec(frame)?.[1] ?? "data";
            events.push(eventName);
            frames += 1;
            if (options.abortAfterFrames !== undefined && frames >= options.abortAfterFrames) {
              aborted = true;
              controller.abort();
              await reader.cancel().catch(() => undefined);
              break;
            }
            boundary = buffer.indexOf("\n\n");
          }
          if (options.abortAfterFrames !== undefined && frames >= options.abortAfterFrames) break;
        }
      } catch (error) {
        if (!aborted) throw error;
      }
      // The partial tail still belongs to the body: an upstream that closes
      // mid-frame must be observable rather than silently dropped.
      text = received + buffer;
      sseEvents = events;
    } else {
      text = await response.text();
    }

    const exchange: Exchange = {
      label: options.label,
      method: options.method,
      path: options.path,
      status: response.status,
      requestId: response.headers.get("x-request-id") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
      bodyExcerpt: excerpt(text),
      bodyBytes: Buffer.byteLength(text, "utf8"),
      setCookieNames: cookieNames(response),
      startedAt,
      durationMs: Date.now() - startedAt,
      ...(sseEvents === undefined ? {} : { sseEvents }),
      ...(aborted ? { aborted: true } : {}),
    };
    this.exchanges.push(exchange);
    return { exchange, response, text };
  }

  async json<T = unknown>(options: RequestOptions): Promise<{ exchange: Exchange; status: number; body: T }> {
    const result = await this.request(options);
    let parsed: unknown = undefined;
    try {
      parsed = result.text.length === 0 ? undefined : JSON.parse(result.text);
    } catch {
      parsed = undefined;
    }
    return { exchange: result.exchange, status: result.exchange.status, body: parsed as T };
  }
}

/** Stable digest used to assert identical serialization across runs. */
export function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
