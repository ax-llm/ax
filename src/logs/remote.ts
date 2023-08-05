import superagent from 'superagent';

import { AIGenerateTextTraceStep } from '../text/types';

const postTrace = async ({
  traceId,
  sessionId,
  ...step
}: Readonly<AIGenerateTextTraceStep>) => {
  const trace = { traceId, sessionId, step };
  await superagent
    .post(`http://localhost:3000/api/a/traces`)
    .set(
      'Cookie',
      '__session=s%3APyzR1ScUb8YnwJ7t7LYpSealN-69v9JR.ZfqRqKTOPJeLQSEUipvIJsCeIbp5P36MiSY%2FXIfvmsM'
    )
    .send(trace)
    .type('json')
    .accept('json')
    .retry(0);
};

export class RemoteLogger {
  //   private traceIndex = 0;

  public log(trace: Readonly<AIGenerateTextTraceStep>): void {
    postTrace(trace);
    // this.traceIndex++;
  }
}
