import { getMemory } from '../tracing/trace.js';

export type MemoryFilter = {
  sessionId?: string;
  user?: string;
  limit?: number;
};

export class RemoteMemoryStore {
  private readonly debug: boolean;
  private readonly apiKey: string;

  constructor(debug: boolean, apiKey: string) {
    this.debug = debug;
    this.apiKey = apiKey;
  }

  fetch = (filter: Readonly<MemoryFilter>) => {
    const memory = getMemory(this.apiKey, this.debug, filter);
    return memory;
  };
}
