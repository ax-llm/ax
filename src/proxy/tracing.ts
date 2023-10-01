import { ConsoleLogger } from '../logs/console.js';
import { RemoteLogger } from '../logs/remote.js';
import { AITextTraceStep } from '../tracing/types.js';

import 'dotenv/config';
import { ExtendedIncomingMessage } from './types.js';

const consoleLog = new ConsoleLogger();

/**
 * Remote Trace Store
 * @group Cache
 * @export
 */
export class RemoteTraceStore {
  private readonly debug: boolean;
  private readonly apiKey?: string;
  private step: AITextTraceStep;

  constructor(
    step: Readonly<AITextTraceStep>,
    debug: boolean,
    apiKey?: string
  ) {
    this.step = step;
    this.debug = debug;
    this.apiKey = apiKey;
  }

  update = (req: Readonly<ExtendedIncomingMessage>) => {
    this.step.traceId = req.traceId;
    this.step.sessionId = req.sessionId;
  };

  async save() {
    const remoteLog = new RemoteLogger();

    if (!this.step) {
      throw new Error('No trace step to send');
    }

    if (this.apiKey) {
      remoteLog.setAPIKey(this.apiKey);
    }

    await remoteLog.log(this.step);

    if (this.debug) {
      consoleLog.log(this.step);
    }
  }
}
