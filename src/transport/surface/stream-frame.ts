export const TEXT_ENCODER = new TextEncoder();

/** Single SSE named-event template shared by every layer (gateway and console). */
export function buildSseEventFrame(event: string, payload: string): string {
  return `event: ${event}\ndata: ${payload}\n\n`;
}

/**
 * Format a Server-Sent Event frame with named event and data.
 * Produces `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`
 */
export function formatSseEvent(event: string, data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return TEXT_ENCODER.encode(buildSseEventFrame(event, payload));
}

/**
 * Format a Server-Sent Event data-only frame.
 * Produces `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`
 */
export function formatSseData(data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return TEXT_ENCODER.encode(`data: ${payload}\n\n`);
}
