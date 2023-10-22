// import { AIPromptConfig, AIServiceActionOptions, AIServiceOptions } from "../../text/types";
// import { TextRequestBuilder, TextResponseBuilder } from "../../tracing";
// import { Anthropic, AnthropicOptions } from "../anthropic";
// import { BaseAI } from "../base";
// import { Cohere, CohereOptions } from "../cohere";
// import { EmbedResponse, TextModelInfo, TextResponse } from "../types";


// type AWSOptions = {modelId: string, embedModelId?: string} & (CohereOptions | AnthropicOptions)

// /**
//  * AWS: AI Service
//  * @export
//  */
// export class AWS  {
//   private options: AWSOptions;
//   private ai: BaseAI;

//     constructor(
//         apiKey: string,
//         options: Readonly<AWSOptions>,
//         otherOptions?: Readonly<AIServiceOptions>
//     ) {
//         this.options = options;

//         if (options.modelId === "anthropic.claude-v2") {
//             this.ai = new Anthropic(apiKey, options as AnthropicOptions, otherOptions);
//         } else if (options.modelId === "cohere.command-text-v14") {
//             this.ai = new Cohere(apiKey, options as CohereOptions, otherOptions);
//         } else {
//             throw new Error('Unknown AWS model: ' + options.modelId);
//         }

//         this.ai.setAPIConfig({
//             url: `https://bedrock.us-east-1.amazonaws.com/model/${options.modelId}`,
//             name: "/invoke"
//         })
//     }

//     name(): string {
//         return "AWS"
//     }

//     getModelInfo(): Readonly<TextModelInfo & { provider: string; }> {
//         return { name: this.options.modelId, provider: this.name() }
//     }
//     getEmbedModelInfo(): Readonly<TextModelInfo> | undefined {
//         return { name: this.options.embedModelId ?? "" }
//     }
   
//     generate(prompt: string, options?: Readonly<AIPromptConfig & AIServiceActionOptions> | undefined): Promise<TextResponse> {
//         return this.ai.generate(prompt, options);
//     }
//     embed(text2Embed: string | readonly string[], options?: Readonly<AIServiceActionOptions> | undefined): Promise<EmbedResponse> {
//         return this.ai.embed(text2Embed, options);
//     }
//     setOptions(options: Readonly<AIServiceOptions>): void {
//         this.ai.setOptions(options);
//     }
//     getTraceRequest(): Readonly<TextRequestBuilder> | undefined {
//         return this.ai.getTraceRequest();
//     }
//     getTraceResponse(): Readonly<TextResponseBuilder> | undefined {
//         return this.ai.getTraceResponse();
//     }
//     traceExists(): boolean {
//        return this.ai.traceExists();
//     }
//     logTrace(): void {
//         this.ai.logTrace();
//     }
// }
