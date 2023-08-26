// import {
//   AIGenerateTextTraceStep,
//   AIPromptConfig,
//   AIService,
//   EmbedResponse,
//   GenerateTextModelConfig,
//   GenerateTextResponse,
//   TextModelInfo,
//   TranscriptResponse,
// } from '../text/types.js';

// /**
//  * Type of the rate limiter function
//  * @export
//  */
// export type RateLimiterFunction = <T>(func: unknown) => T;

// export class AI implements AIService {
//   private traceSteps: AIGenerateTextTraceStep[] = [];
//   private ai: AIService;
//   private rt?: RateLimiterFunction;

//   constructor(ai: AIService, rateLimiter?: RateLimiterFunction) {
//     this.ai = ai;
//     this.rt = rateLimiter;
//   }
//   newTraceStep(): AIGenerateTextTraceStep {
//     throw new Error('Method not implemented.');
//   }
//   getTraceStep(): AIGenerateTextTraceStep | undefined {
//     throw new Error('Method not implemented.');
//   }

//   getTraceSteps(): AIGenerateTextTraceStep[] {
//     return this.traceSteps;
//   }

//   getModelInfo(): Readonly<TextModelInfo & { provider: string }> {
//     throw new Error('Method not implemented.');
//   }
//   getEmbedModelInfo(): Readonly<TextModelInfo> | undefined {
//     throw new Error('Method not implemented.');
//   }
//   getModelConfig(): Readonly<GenerateTextModelConfig> {
//     throw new Error('Method not implemented.');
//   }

//   name(): string {
//     return this.ai.name();
//   }

//   async generate(
//     prompt: string,
//     md: Readonly<AIPromptConfig>,
//     sessionId?: string
//   ): Promise<GenerateTextResponse> {
//     let modelResponseTime;

//     const fn = async () => {
//       const st = new Date().getTime();
//       const res = await this.ai.generate(prompt, md, sessionId);
//       modelResponseTime = new Date().getTime() - st;
//       return res;
//     };

//     const trace = this.ai.newTraceStep(prompt);

//     const res = this.rt
//       ? await this.rt<Promise<GenerateTextResponse>>(fn)
//       : await fn();

//     if (trace) {
//       trace.response = {
//         remoteId: res?.remoteId,
//         results: res?.results ?? [],
//         modelUsage: res?.modelUsage,
//         embedModelUsage: res?.embedModelUsage,
//         modelResponseTime,
//       };
//     }

//     return res;
//   }

//   async embed(
//     textToEmbed: readonly string[] | string,
//     sessionId?: string
//   ): Promise<EmbedResponse> {
//     let embedModelResponseTime;

//     const fn = async () => {
//       const st = new Date().getTime();
//       const res = await this.ai.embed(textToEmbed, sessionId);
//       embedModelResponseTime = new Date().getTime() - st;
//       return res;
//     };

//     const step = this.ai.getTraceStep() as AIGenerateTextTraceStep;
//     if (step) {
//       step.request.embedModelInfo = this.ai.getEmbedModelInfo();
//     }

//     const res = this.rt
//       ? await this.rt<Promise<EmbedResponse>>(async () => fn())
//       : await fn();

//     if (step) {
//       step.response.embedModelResponseTime = embedModelResponseTime;
//       step.response.embedModelUsage = res.modelUsage;
//     }

//     return res;
//   }

//   async transcribe(
//     file: string,
//     prompt?: string,
//     language?: string,
//     sessionId?: string
//   ): Promise<TranscriptResponse> {
//     if (!this.ai.transcribe) {
//       throw new Error('Transcribe not supported');
//     }
//     return this.rt
//       ? this.rt<Promise<TranscriptResponse>>(async () =>
//           this.ai.transcribe
//             ? await this.ai.transcribe(file, prompt, language, sessionId)
//             : null
//         )
//       : await this.ai.transcribe(file, prompt, language, sessionId);
//   }
// }
