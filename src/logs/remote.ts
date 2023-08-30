import chalk from 'chalk';

import { AIGenerateTextTraceStep } from '../text/types';
import { sendTrace } from '../tracing/index.js';

export class RemoteLogger {
  private apiKey?: string;
  private devMode = false;

  constructor() {
    this.apiKey = process.env.LLMCLIENT_APIKEY ?? process.env.LLMC_APIKEY;
    this.devMode = process.env.DEV_MODE === 'true';
  }

  setAPIKey(apiKey: string): void {
    if (apiKey.length === 0) {
      throw new Error('Invalid LLM Client API key');
    }
    this.apiKey = apiKey;
  }

  printDebugInfo() {
    if (!this.apiKey || this.apiKey.length === 0) {
      return;
    }
    const logTo = this.devMode ? 'localhost:3000 (dev mode)' : 'llmclient.com';
    const msg = `🦙 Remote logging traces to ${logTo}`;
    console.log(chalk.yellowBright(msg));
  }

  log(trace: Readonly<AIGenerateTextTraceStep>): void {
    if (!this.apiKey || this.apiKey.length === 0) {
      return;
    }
    sendTrace(trace, this.apiKey, this.devMode);
  }
}
