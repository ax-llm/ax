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
  private apiKey: string;
  private devMode = false;

  constructor(apiKey: string, devMode = false) {
    this.apiKey = apiKey;
    this.devMode = devMode;

    console.log(
      chalk.magentaBright(`🦙 Remote logging traces to llmclient.com`)
    );
  }

  public log(trace: Readonly<AIGenerateTextTraceStep>): void {
    postTrace(this.apiKey, this.devMode, trace);
  }
}
