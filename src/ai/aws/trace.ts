// import { ExtendedIncomingMessage } from "../../proxy/types.js";
// import { AITextTraceStep } from "../../tracing/types.js";
// import { AnthropicCompletionMiddleware } from "../anthropic/trace";
// import { CohereCompletionMiddleware } from "../cohere/trace.js";
// import { PromptUpdater } from "../middleware";
// import { AIMiddleware } from "../types";

// export class AWSCompletionMiddleware
//   implements AIMiddleware
// {
//   private mw : AIMiddleware

//   constructor(exReq: Readonly<ExtendedIncomingMessage>, modelId: string) {
//     if (modelId === "anthropic.claude-v2") {
//       this.mw = new AnthropicCompletionMiddleware(exReq);
//     } else if (modelId === "cohere.command-text-v14") {
//         this.mw = new CohereCompletionMiddleware(exReq);
//     } else {
//       throw new Error('Unknown AWS model: ' + modelId);
//     }
//   }

//   getTrace(req: Readonly<ExtendedIncomingMessage>): AITextTraceStep {
//     return this.mw.getTrace(req);
//   }

//   isRequestUpdated(): boolean {
//     return this.mw.isRequestUpdated();
//   }

//   renderRequest(): string {
//     return this.mw.renderRequest();
//   }

//   getAPIKey(): string {
//     return this.mw.getAPIKey();
//   }

//   addRequest = async (request: string, fn?: PromptUpdater) => {
//     await this.mw.addRequest(request, fn)
//   };

//   addResponse = (response: string) => {
//     this.mw.addResponse(response)
//   };
// }
  