// Web Streams API types are now available globally via DOM types in tsconfig

interface CurrentEventState {
  event?: string;
  rawData: string;
  id?: string;
  retry?: number;
}

interface SSEParserOptions<T> {
  dataParser?: (data: string) => T;
  onError?: (error: Error, rawData: string) => void;
}

export class SSEParser<T = unknown> extends TransformStream<string, T> {
  private buffer = '';
  private currentEvent: CurrentEventState = { rawData: '' };
  private dataParser: (data: string) => T;
  private onError: (error: Error, rawData: string) => void;

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
  }

  private handleChunk(
    chunk: string,
    controller: TransformStreamDefaultController<T>
  ): void {
    this.buffer += chunk;
    this.processBuffer(controller);
  }

  private handleFlush(controller: TransformStreamDefaultController<T>): void {
    this.processBuffer(controller, true);
    if (this.currentEvent.rawData) {
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

    // Normalize newlines to \n
    const normalizedBuffer = pendingBuffer.replace(/\r\n|\r/g, '\n');
    const lines = normalizedBuffer.split('\n');
    this.buffer = (lines.pop() || '') + pendingCarriageReturn;

    for (const line of lines) {
      if (line === '') {
        this.processEvent(controller);
      } else {
        this.parseLine(line);
      }
    }
  }

  private parseLine(line: string): void {
    if (line.startsWith(':')) {
      return; // Ignore comment lines
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      this.currentEvent.rawData +=
        (this.currentEvent.rawData && !this.currentEvent.rawData.endsWith('\n')
          ? '\n'
          : '') + line.trim();
      return;
    }

    const field = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    switch (field) {
      case 'event':
        this.currentEvent.event = value;
        break;
      case 'data':
        this.currentEvent.rawData +=
          (this.currentEvent.rawData &&
          !this.currentEvent.rawData.endsWith('\n')
            ? '\n'
            : '') + value;
        break;
      case 'id':
        this.currentEvent.id = value;
        break;
      case 'retry': {
        const retryValue = Number.parseInt(value, 10);
        if (!Number.isNaN(retryValue)) {
          this.currentEvent.retry = retryValue;
        }
        break;
      }
    }
  }

  private processEvent(controller: TransformStreamDefaultController<T>): void {
    if (this.currentEvent.rawData) {
      if (!this.currentEvent.event) {
        this.currentEvent.event = 'message';
      }

      if (this.currentEvent.rawData.trim() === '[DONE]') {
        // maybe we want to emit [DONE] to signal the end of the stream
        // controller.enqueue('[DONE]' as any)
        // Reset the current event
        this.currentEvent = { rawData: '' };
        return;
      }

      try {
        const parsedData: T = this.dataParser(this.currentEvent.rawData);
        controller.enqueue(parsedData);
      } catch (e) {
        this.onError(e as Error, this.currentEvent.rawData);
      }

      this.currentEvent = { rawData: '' };
    }
  }
}
