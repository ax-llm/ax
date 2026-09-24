/**
 * Parses the JSON payload of a WebSocket message. Takes a `message` event, or
 * the raw data that an EventEmitter-style socket such as `ws` passes.
 *
 * Servers may send JSON in binary frames; Gemini Live sends every message that
 * way. Browsers and Node's global WebSocket deliver binary frames as a Blob,
 * which cannot be read synchronously, so set `binaryType = 'arraybuffer'` on
 * the socket before it opens. `ws` delivers a Buffer, which is read as is.
 */
export function parseWebSocketMessage(event: any): any {
  const data = event?.data ?? event;
  if (typeof data === 'string') {
    return JSON.parse(data);
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return JSON.parse(new TextDecoder().decode(data));
  }
  throw new Error(
    `Cannot read a WebSocket message delivered as ${Object.prototype.toString.call(data).slice(8, -1)}; expected text or an ArrayBuffer`
  );
}
