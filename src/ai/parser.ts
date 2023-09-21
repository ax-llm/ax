import { ExtendedIncomingMessage } from '../proxy/types.js';
import { AITextTraceStepBuilder } from '../tracing/trace.js';
import { AITextTraceStep } from '../tracing/types.js';

export type Prompt = {
  role?: string;
  text: string;
};

export type PromptUpdater = ({
  prompt,
  user,
}: Readonly<{ prompt?: string; user?: string }>) => Promise<Prompt[]>;

export class BaseParser<AIRequest, AIResponse> {
  protected sb = new AITextTraceStepBuilder();
  protected reqBody?: string;
  protected resBody?: string;

  protected req?: AIRequest;
  protected resp?: AIResponse;
  protected reqUpdated = false;

  protected addRequest(request: string) {
    if (!this.req) {
      this.req = JSON.parse(request);
    }
  }

  protected addResponse(response: string) {
    if (!this.resp) {
      this.resp = JSON.parse(response);
    }
  }

  public getTrace(req: Readonly<ExtendedIncomingMessage>): AITextTraceStep {
    return this.sb
      .setApiError(req.error)
      .setTraceId(req.traceId)
      .setSessionId(req.sessionId)
      .setModelResponseTime(Date.now() - req.startTime)
      .build();
  }

  public isRequestUpdated() {
    return this.reqUpdated;
  }

  public renderRequest() {
    return JSON.stringify(this.req);
  }
}
