// Web Streams API types are now available globally via DOM types in tsconfig

interface CurrentEventState {
  event?: string;
  dataLines: string[];
}

interface SSEEventMetadata {
  event: string;
  id: string;
  retry?: number;
}

interface SSEParserOptions<T> {
  dataParser?: (data: string) => T;
  onError?: (error: Error, rawData: string) => void;
  onEvent?: (data: T, metadata: SSEEventMetadata) => void;
  /**
   * Provider streams occasionally omit the final SSE blank line. Keep Ax's
   * compatibility behavior by default, while allowing strict SSE consumers to
   * discard the incomplete final event as required by the HTML standard.
   */
  emitIncompleteEventOnEof?: boolean;
}

export class SSEParser<T = unknown> extends TransformStream<string, T> {
  private buffer = '';
  private currentEvent: CurrentEventState = { dataLines: [] };
  private dataParser: (data: string) => T;
  private onError: (error: Error, rawData: string) => void;
  private onEvent?: (data: T, metadata: SSEEventMetadata) => void;
  private emitIncompleteEventOnEof: boolean;
  private lastEventId = '';
  private retry?: number;
  private atStart = true;
  private terminated = false;

  constructor(options: SSEParserOptions<T> = {}) {
    super({
      transform: (chunk, controller) => this.handleChunk(chunk, controller),
      flush: (controller) => this.handleFlush(controller),
    });

    this.dataParser = options.dataParser || JSON.parse;
    this.onError =
      options.onError ||
      ((error, rawData) => {
        console.warn('Failed to parse event data:', error);
        console.log('Raw data that failed to parse:', rawData);
      });
    this.onEvent = options.onEvent;
    this.emitIncompleteEventOnEof = options.emitIncompleteEventOnEof ?? true;
  }

  private handleChunk(
    chunk: string,
    controller: TransformStreamDefaultController<T>
  ): void {
    this.buffer += chunk;
    if (this.atStart && this.buffer.length > 0) {
      this.atStart = false;
      if (this.buffer.startsWith('\uFEFF')) {
        this.buffer = this.buffer.slice(1);
      }
    }
    this.processBuffer(controller);
  }

  private handleFlush(controller: TransformStreamDefaultController<T>): void {
    if (this.terminated) return;

    this.processBuffer(controller, true);
    if (this.terminated) return;

    if (!this.emitIncompleteEventOnEof) {
      this.buffer = '';
      this.currentEvent = { dataLines: [] };
      return;
    }

    // Ax provider streams have historically accepted a final event without
    // the spec's terminating blank line. Treat any residual text as its final
    // line, then dispatch the pending event so browser and server runtimes
    // behave identically.
    if (this.buffer.length > 0) {
      this.parseLine(this.buffer);
      this.buffer = '';
    }
    if (this.currentEvent.dataLines.length > 0) {
      this.processEvent(controller);
    }
  }

  private processBuffer(
    controller: TransformStreamDefaultController<T>,
    isFinal = false
  ): void {
    // A \r\n line terminator can straddle a chunk boundary. Normalizing the
    // buffer while it still ends in \r would turn that half into a \n and
    // consume it as a line terminator, and the \n arriving in the next chunk
    // would then read as a blank line -- dispatching the event early and
    // splitting multi-line data fields in two. Hold a trailing \r back until
    // the next chunk shows what follows it. At the end of the stream nothing
    // follows, so the \r is a terminator in its own right.
    let pendingBuffer = this.buffer;
    let pendingCarriageReturn = '';
    if (!isFinal && pendingBuffer.endsWith('\r')) {
      pendingBuffer = pendingBuffer.slice(0, -1);
      pendingCarriageReturn = '\r';
    }

    const normalizedBuffer = pendingBuffer.replace(/\r\n|\r/g, '\n');
    const lines = normalizedBuffer.split('\n');
    this.buffer = (lines.pop() || '') + pendingCarriageReturn;

    for (const line of lines) {
      if (line === '') {
        if (this.processEvent(controller)) return;
      } else {
        this.parseLine(line);
      }
    }
  }

  private parseLine(line: string): void {
    if (line.startsWith(':')) return;

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    // SSE removes at most one U+0020 after the colon. Other leading and
    // trailing whitespace is data and must be preserved.
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        this.currentEvent.event = value;
        break;
      case 'data':
        this.currentEvent.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.lastEventId = value;
        break;
      case 'retry':
        if (/^[0-9]+$/.test(value)) this.retry = Number(value);
        break;
    }
  }

  private processEvent(
    controller: TransformStreamDefaultController<T>
  ): boolean {
    const event = this.currentEvent;
    this.currentEvent = { dataLines: [] };

    if (event.dataLines.length === 0) return false;

    const rawData = event.dataLines.join('\n');
    if (rawData.trim() === '[DONE]') {
      this.terminated = true;
      // Terminating the transform closes its readable side and cancels the
      // upstream response body instead of leaving it open after [DONE].
      controller.terminate();
      return true;
    }

    let parsedData: T;
    try {
      parsedData = this.dataParser(rawData);
    } catch (e) {
      this.onError(e as Error, rawData);
      return false;
    }

    this.onEvent?.(parsedData, {
      event: event.event || 'message',
      id: this.lastEventId,
      retry: this.retry,
    });
    controller.enqueue(parsedData);

    return false;
  }
}
