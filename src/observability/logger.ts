import pino from 'pino';
import { pushConsoleLog, type ConsoleLogLevel } from './log-ring';
import { redactTelemetryText, redactTelemetryValue } from './redaction';

/**
 * Structured logger using Pino for production-ready logging.
 * Replaces console.log/warn/error with structured, level-based logging.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Pretty-printing runs the `pino-pretty` transport in a **worker thread**, and
 * that thread outlives the log call: it is torn down when the process exits,
 * which in a test worker means it can exit mid-run and take the worker with it
 * (`error: the worker thread exited`, surfacing as unrelated failures across
 * whatever file the worker was running). It is also pure presentation - a
 * human reading a terminal - so it is enabled only for an interactive TTY.
 * Piped output, CI, and tests get the plain JSON transport, which writes on
 * the calling thread and has nothing to tear down.
 */
const wantsPrettyTransport = isDevelopment && process.stdout.isTTY === true;

const baseOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
  },
  serializers: {
    error: pino.stdSerializers.err,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Pretty print for an interactive terminal, JSON everywhere else.
const developmentOptions = wantsPrettyTransport
  ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    }
  : {};

const logger = pino({
  ...baseOptions,
  ...developmentOptions,
});

/** Sanitize both terminal output and the dashboard ring without changing wire data. */
function safeLogValue(value: unknown): unknown {
  try {
    return redactTelemetryValue(value);
  } catch {
    return "[unserializable args]";
  }
}

function safeLogArgs(args: readonly unknown[]): unknown[] {
  const safe = safeLogValue(args);
  return Array.isArray(safe) ? safe : [safe];
}

function formatRingMessage(msg: string, args: readonly unknown[]): string {
  if (args.length === 0) return msg;
  let rendered = "";
  try {
    rendered = JSON.stringify(args.length === 1 ? args[0] : args) ?? "";
  } catch {
    rendered = "[unserializable args]";
  }
  return rendered.length > 0 ? `${msg} ${rendered}` : msg;
}

function ring(level: ConsoleLogLevel, msg: string, safeArgs: readonly unknown[]): void {
  try {
    pushConsoleLog(level, msg.length > 0 ? formatRingMessage(msg, safeArgs) : formatRingMessage("(empty)", safeArgs));
  } catch {
    // The ring is observability-only; it must never break the log call itself.
  }
}

function logArgs(level: ConsoleLogLevel, write: (args: unknown[], message: string) => void, msg: string, args: readonly unknown[]): void {
  const safeArgs = safeLogArgs(args);
  const safeMessage = redactTelemetryText(msg);
  ring(level, safeMessage, safeArgs);
  write(safeArgs, safeMessage);
}

function safeErrorForRing(error: Error): unknown {
  return safeLogValue(error);
}

function safeErrorForPino(error: Error): Error {
  const fields: Record<string, unknown> = {};
  try {
    Object.assign(fields, error);
  } catch {
    // Preserve the standard Error fields below if a custom enumerable getter fails.
  }
  fields.name = error.name;
  fields.message = error.message;
  if (typeof error.stack === "string") fields.stack = error.stack;
  const redacted = safeLogValue(fields);
  const safeFields =
    typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
      ? redacted as Record<string, unknown>
      : {};
  const safe = new Error(
    typeof safeFields["message"] === "string" ? safeFields["message"] : "[unserializable error]",
  );
  safe.name = typeof safeFields["name"] === "string" ? safeFields["name"] : "Error";
  if (typeof safeFields["stack"] === "string") safe.stack = safeFields["stack"];
  const extras = { ...safeFields };
  delete extras["name"];
  delete extras["message"];
  delete extras["stack"];
  Object.assign(safe, extras);
  return safe;
}

function logError(msg: string, error: Error | undefined, args: readonly unknown[]): void {
  const safeMessage = redactTelemetryText(msg);
  const safe = safeLogArgs(args);
  const ringError = error === undefined ? undefined : safeErrorForRing(error);
  const pinoError = error === undefined ? undefined : safeErrorForPino(error);
  ring("error", safeMessage, error === undefined ? safe : [ringError, ...safe]);
  logger.error({ ...(pinoError === undefined ? {} : { error: pinoError }), args: safe }, safeMessage);
}

export const log = {
  debug: (msg: string, ...args: unknown[]) =>
    logArgs("debug", (safe, message) => logger.debug({ args: safe }, message), msg, args),
  info: (msg: string, ...args: unknown[]) =>
    logArgs("info", (safe, message) => logger.info({ args: safe }, message), msg, args),
  warn: (msg: string, ...args: unknown[]) =>
    logArgs("warn", (safe, message) => logger.warn({ args: safe }, message), msg, args),
  error: (msg: string, error?: Error, ...args: unknown[]) => logError(msg, error, args),
};
