import { TransformStream, TransformStreamDefaultController } from 'stream/web';

interface CurrentEventState {
  event?: string;
  rawData: string;
  id?: string;
  retry?: number;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export class SSEParser<T = unknown> extends TransformStream<string, T> {
  private buffer: string = '';
  private currentEvent: CurrentEventState = { rawData: '' };

  constructor(private readonly dataParser: (data: string) => T = JSON.parse) {
    super({
      transform: (chunk, controller) => this.handleChunk(chunk, controller),
      flush: (controller) => this.handleFlush(controller)
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
    this.processBuffer(controller);
    if (this.currentEvent.rawData) {
      this.emitEvent(controller);
    }
  }

  private processBuffer(controller: TransformStreamDefaultController<T>): void {
    const lines = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim() === '') {
        this.emitEvent(controller);
      } else {
        this.parseLine(line);
      }
    }
  }

  private parseLine(line: string): void {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      // If there's no colon, treat the whole line as data
      this.currentEvent.rawData += this.currentEvent.rawData
        ? '\n' + line.trim()
        : line.trim();
      return;
    }

    const field = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    switch (field) {
      case 'event':
        this.currentEvent.event = value;
        break;
      case 'data':
        this.currentEvent.rawData += this.currentEvent.rawData
          ? '\n' + value
          : value;
        break;
      case 'id':
        this.currentEvent.id = value;
        break;
      case 'retry': {
        const retryValue = parseInt(value, 10);
        if (!isNaN(retryValue)) {
          this.currentEvent.retry = retryValue;
        }
        break;
      }
    }
  }

  private emitEvent(controller: TransformStreamDefaultController<T>): void {
    if (this.currentEvent.rawData) {
      // Check for special "[DONE]" message or other non-JSON data
      if (
        this.currentEvent.rawData.trim() === '[DONE]' ||
        this.currentEvent.rawData.trim().startsWith('[')
      ) {
        return;
      } else {
        try {
          // Attempt to parse the data using the provided dataParser
          const parsedData: T = this.dataParser(this.currentEvent.rawData);
          // Emit only if we successfully parsed the data
          controller.enqueue(parsedData);
        } catch (e) {
          // If parsing fails, log the error without emitting
          console.warn('Failed to parse event data:', e);
          console.log(
            'Raw data that failed to parse:',
            this.currentEvent.rawData
          );
        }
      }

      // Reset the current event
      this.currentEvent = { rawData: '' };
    }
  }
}
