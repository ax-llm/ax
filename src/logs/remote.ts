import superagent from 'superagent';

import { AIGenerateTextTrace } from '../text/types';

const postTrace = async (trace: Readonly<AIGenerateTextTrace>) => {
  const res = await superagent
    .post(`http://localhost:3000/api/a/traces`)
    .set(
      'Cookie',
      '__session=s%3APyzR1ScUb8YnwJ7t7LYpSealN-69v9JR.ZfqRqKTOPJeLQSEUipvIJsCeIbp5P36MiSY%2FXIfvmsM'
    )
    .send(trace)
    .type('json')
    .accept('json')
    .retry(0);

  console.log(res);
};

export class RemoteLogger {
  //   private traceIndex = 0;

  public log(trace: Readonly<AIGenerateTextTrace>): void {
    postTrace(trace);
    // this.traceIndex++;
  }
}
