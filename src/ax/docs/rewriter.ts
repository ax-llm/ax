// import { AxGen } from '../dsp/generate.js'
// import type { AxProgramForwardOptions } from '../dsp/types.js'

// import { type AxRewriteIn, type AxRewriteOut } from './manager.js'

// export class AxDefaultQueryRewriter extends AxGen<AxRewriteIn, AxRewriteOut> {
//   constructor(options?: Readonly<AxProgramForwardOptions>) {
//     const signature = `"You are a query rewriter assistant tasked with rewriting a given query to improve its clarity, specificity, and relevance. Your role involves analyzing the query to identify any ambiguities, generalizations, or irrelevant information and then rephrasing it to make it more focused and precise. The rewritten query should be concise, easy to understand, and directly related to the original query. Output only the rewritten query."
//     query: string -> rewrittenQuery: string`

//     super(signature, options)
//   }
// }

// export class AxRewriter extends AxGen<AxRewriteIn, AxRewriteOut> {
//   constructor(options?: Readonly<AxProgramForwardOptions>) {
//     super(
//       '"Rewrite a given text to be clear and concise" original -> rewritten "improved text"',
//       options
//     )
//   }
// }
