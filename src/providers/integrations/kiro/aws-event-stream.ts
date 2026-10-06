// AWS EventStream framing, as used by the CodeWhisperer streaming surface.
//
// The upstream answers a request with a sequence of self-describing binary
// messages rather than SSE. Each message is:
//
//   total_length     uint32 BE   offset 0   (whole message, including this field)
//   headers_length   uint32 BE   offset 4   (bytes of the header block)
//   prelude_crc32    uint32 BE   offset 8   (CRC32 of bytes 0..8)
//   headers          bytes       offset 12
//   payload          bytes       offset 12 + headers_length
//   message_crc32    uint32 BE   last 4 bytes (CRC32 of everything before it)
//
// Both CRCs use the IEEE polynomial (0xedb88320) and are verified here, because
// a truncated or interleaved message otherwise decodes into plausible-looking
// JSON that a provider adapter would happily stream to a client. A message that
// fails its CRC is a corrupt stream, not a partial answer.
//
// Only the envelope and the header block live here; which event types exist and
// what their payloads mean belongs to the adapter that reads them.

/** IEEE CRC32 polynomial, reflected. */
const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ CRC32_POLYNOMIAL : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

/** CRC32 of `bytes`, as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    crc = ((crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed part of a message: total length, headers length, prelude CRC. */
export const EVENTSTREAM_PRELUDE_BYTES = 12;
/** Trailing message CRC. */
export const EVENTSTREAM_TRAILER_BYTES = 4;
/** Smallest possible message: prelude + trailer, no headers or payload. */
export const EVENTSTREAM_MIN_MESSAGE_BYTES = EVENTSTREAM_PRELUDE_BYTES + EVENTSTREAM_TRAILER_BYTES;

/**
 * Ceiling on one message. The largest thing this surface sends is a single
 * assistant delta, so a message claiming more than this is a framing error and
 * reading it would only allocate attacker-chosen memory.
 */
export const EVENTSTREAM_MAX_MESSAGE_BYTES = 24 * 1024 * 1024;

/** Ceiling on the header block of one message. */
export const EVENTSTREAM_MAX_HEADERS_BYTES = 128 * 1024;

/** One decoded EventStream message. */
export interface EventStreamMessage {
  /** Header values by name. Only `:message-type` and `:event-type` are read today. */
  readonly headers: Readonly<Record<string, string>>;
  /** Decoded UTF-8 payload. `null` when the message carries no payload. */
  readonly payload: string | null;
}

/** Reason a message could not be decoded; the caller turns this into its own error. */
export type EventStreamDecodeFailure =
  | "truncated"
  | "oversize_message"
  | "oversize_headers"
  | "prelude_crc_mismatch"
  | "message_crc_mismatch"
  | "malformed_headers"
  | "invalid_payload_utf8";

export interface EventStreamDecodeResult {
  /** Messages decoded from the buffered bytes, in order. */
  readonly messages: readonly EventStreamMessage[];
  /** Bytes consumed from the buffer; the caller drops exactly this many. */
  readonly consumed: number;
  /** Set when decoding stopped on a corrupt message rather than on a short buffer. */
  readonly failure?: { readonly reason: EventStreamDecodeFailure; readonly detail: string };
}

/**
 * Decodes as many whole messages as `buffer` holds.
 *
 * A trailing partial message is not an error: the caller appends the next read
 * and calls again. Anything that fails validation stops the loop and is
 * reported, because every byte after a corrupt message is untrustworthy.
 */
export function decodeEventStreamMessages(buffer: Uint8Array): EventStreamDecodeResult {
  const messages: EventStreamMessage[] = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (;;) {
    const remaining = buffer.byteLength - offset;
    if (remaining < EVENTSTREAM_MIN_MESSAGE_BYTES) break;

    const totalLength = view.getUint32(offset, false);
    const headersLength = view.getUint32(offset + 4, false);
    if (totalLength < EVENTSTREAM_MIN_MESSAGE_BYTES) {
      return {
        messages,
        consumed: offset,
        failure: {
          reason: "truncated",
          detail: `message length ${totalLength} is below the ${EVENTSTREAM_MIN_MESSAGE_BYTES}-byte minimum`,
        },
      };
    }
    if (totalLength > EVENTSTREAM_MAX_MESSAGE_BYTES) {
      return {
        messages,
        consumed: offset,
        failure: {
          reason: "oversize_message",
          detail: `message length ${totalLength} exceeds the ${EVENTSTREAM_MAX_MESSAGE_BYTES}-byte cap`,
        },
      };
    }
    if (headersLength > EVENTSTREAM_MAX_HEADERS_BYTES) {
      return {
        messages,
        consumed: offset,
        failure: {
          reason: "oversize_headers",
          detail: `header block ${headersLength} exceeds the ${EVENTSTREAM_MAX_HEADERS_BYTES}-byte cap`,
        },
      };
    }
    if (headersLength > totalLength - EVENTSTREAM_MIN_MESSAGE_BYTES) {
      return {
        messages,
        consumed: offset,
        failure: {
          reason: "malformed_headers",
          detail: `header block ${headersLength} does not fit in a ${totalLength}-byte message`,
        },
      };
    }
    // A short buffer is not a failure — the rest of this message has not arrived.
    if (remaining < totalLength) break;

    const messageEnd = offset + totalLength;
    const declaredPreludeCrc = view.getUint32(offset + 8, false);
    const actualPreludeCrc = crc32(buffer.subarray(offset, offset + 8));
    if (declaredPreludeCrc !== actualPreludeCrc) {
      return {
        messages,
        consumed: offset,
        failure: {
          reason: "prelude_crc_mismatch",
          detail: `prelude CRC ${declaredPreludeCrc} does not match computed ${actualPreludeCrc}`,
        },
      };
    }
    const declaredMessageCrc = view.getUint32(messageEnd - EVENTSTREAM_TRAILER_BYTES, false);
    const actualMessageCrc = crc32(buffer.subarray(offset, messageEnd - EVENTSTREAM_TRAILER_BYTES));
    if (declaredMessageCrc !== actualMessageCrc) {
      return {
        messages,
        consumed: offset,
        failure: {
          reason: "message_crc_mismatch",
          detail: `message CRC ${declaredMessageCrc} does not match computed ${actualMessageCrc}`,
        },
      };
    }

    const headerStart = offset + EVENTSTREAM_PRELUDE_BYTES;
    const headers = decodeEventStreamHeaders(
      buffer.subarray(headerStart, headerStart + headersLength),
    );
    if (headers instanceof Error) {
      return {
        messages,
        consumed: offset,
        failure: { reason: "malformed_headers", detail: headers.message },
      };
    }

    const payloadStart = headerStart + headersLength;
    const payloadEnd = messageEnd - EVENTSTREAM_TRAILER_BYTES;
    let payload: string | null = null;
    if (payloadEnd > payloadStart) {
      try {
        payload = new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(payloadStart, payloadEnd),
        );
      } catch {
        return {
          messages,
          consumed: offset,
          failure: {
            reason: "invalid_payload_utf8",
            detail: "message payload is not valid UTF-8",
          },
        };
      }
    }
    messages.push({ headers, payload });
    offset = messageEnd;
  }
  return { messages, consumed: offset };
}

/**
 * Decodes one EventStream header block into a flat string map.
 *
 * The block is a sequence of `{name length, name, value type, value}` records.
 * Value types are: 0/1 boolean, 2 int8, 3 int16, 4 int32, 5/8/9 fixed-width
 * integers this surface never sends, 6 byte array, 7 string. Numeric and
 * boolean values are stringified so callers see one map type; the fixed-width
 * integer types are skipped rather than guessed at.
 */
function decodeEventStreamHeaders(bytes: Uint8Array): Record<string, string> | Error {
  const headers: Record<string, string> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + 1 > bytes.byteLength) return new Error("header name length is truncated");
    const nameLength = bytes[offset] ?? 0;
    offset += 1;
    if (offset + nameLength > bytes.byteLength) return new Error("header name is truncated");
    const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    if (offset + 1 > bytes.byteLength) return new Error(`header ${name} has no value type`);
    const valueType = bytes[offset] ?? 0;
    offset += 1;

    switch (valueType) {
      case 0:
      case 1: {
        headers[name] = valueType === 1 ? "true" : "false";
        break;
      }
      case 2: {
        if (offset + 1 > bytes.byteLength) return new Error(`header ${name} is truncated`);
        headers[name] = String(view.getInt8(offset));
        offset += 1;
        break;
      }
      case 3: {
        if (offset + 2 > bytes.byteLength) return new Error(`header ${name} is truncated`);
        headers[name] = String(view.getInt16(offset, false));
        offset += 2;
        break;
      }
      case 4: {
        if (offset + 4 > bytes.byteLength) return new Error(`header ${name} is truncated`);
        headers[name] = String(view.getInt32(offset, false));
        offset += 4;
        break;
      }
      case 5:
      case 8: {
        if (offset + 8 > bytes.byteLength) return new Error(`header ${name} is truncated`);
        offset += 8;
        break;
      }
      case 9: {
        if (offset + 16 > bytes.byteLength) return new Error(`header ${name} is truncated`);
        offset += 16;
        break;
      }
      case 6:
      case 7: {
        if (offset + 2 > bytes.byteLength) return new Error(`header ${name} is truncated`);
        const valueLength = view.getUint16(offset, false);
        offset += 2;
        if (offset + valueLength > bytes.byteLength) {
          return new Error(`header ${name} value is truncated`);
        }
        const value = bytes.subarray(offset, offset + valueLength);
        offset += valueLength;
        headers[name] =
          valueType === 7 ? new TextDecoder().decode(value) : Buffer.from(value).toString("base64");
        break;
      }
      default: {
        return new Error(`header ${name} has unknown value type ${valueType}`);
      }
    }
  }
  return headers;
}
