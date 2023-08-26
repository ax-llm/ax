import chalk from 'chalk';
import superagent from 'superagent';

import { AIGenerateTextTraceStep } from '../text/types';

const postTrace = async (
  apiKey: string,
  devMode: boolean,
  { traceId, sessionId, ...step }: Readonly<AIGenerateTextTraceStep>
) => {
  const host = devMode ? 'http://localhost:3000' : 'https://api.llmclient.com';
  const trace = { traceId, sessionId, step };

  await superagent
    .post(new URL(`/api/t/traces`, host).href)
    .set('x-api-key', apiKey)
    .send(trace)
    .type('json')
    .accept('json')
    .retry(1);
};

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
    postTrace(this.apiKey, this.devMode, trace);
  }
}
