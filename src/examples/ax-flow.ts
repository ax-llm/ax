// AxFlow usage examples: full method names and aliases
import { AxAI, AxAIGoogleGeminiModel, AxFlow } from '@ax-llm/ax'

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
})

// Full method example - Document analysis pipeline
const flowFull = new AxFlow<{ documentContent: string }, { analysis: string }>()
  .node('summarizer', 'documentContent:string -> documentSummary:string')
  .node('keywordExtractor', 'documentSummary:string -> keywords:string[]')
  .node(
    'sentimentAnalyzer',
    'documentSummary:string -> sentiment:string, confidence:number'
  )
  .execute('summarizer', (state) => ({
    documentContent: state.documentContent,
  }))
  .execute('keywordExtractor', (state) => ({
    documentSummary: state.summarizerResult.documentSummary,
  }))
  .execute('sentimentAnalyzer', (state) => ({
    documentSummary: state.summarizerResult.documentSummary,
  }))
  .map((state) => {
    const keywords = Array.isArray(state.keywordExtractorResult.keywords)
      ? state.keywordExtractorResult.keywords
      : []
    return {
      analysis: `Summary: ${state.summarizerResult.documentSummary}, Keywords: ${keywords.join(', ')}, Sentiment: ${state.sentimentAnalyzerResult.sentiment} (${state.sentimentAnalyzerResult.confidence})`,
    }
  })

// Aliases example 1 - Customer support ticket processing
const flowAlias1 = new AxFlow<{ ticketMessage: string }, { response: string }>()
  .n(
    'classifier',
    'customerMessage:string -> ticketCategory:string, urgencyLevel:string'
  )
  .n(
    'responder',
    'ticketCategory:string, urgencyLevel:string -> supportResponse:string'
  )
  .e('classifier', (state) => ({ customerMessage: state.ticketMessage }))
  .e('responder', (state) => ({
    ticketCategory: state.classifierResult.ticketCategory,
    urgencyLevel: state.classifierResult.urgencyLevel,
  }))
  .m((state) => ({ response: state.responderResult.supportResponse }))

// Aliases example 2 - Simplified code review system
const flowAlias2 = new AxFlow<{ codeSnippet: string }, { review: string }>()
  .n(
    'codeAnalyzer',
    'sourceCode:string -> codeAnalysis:string, qualityScore:number'
  )
  .n(
    'reviewGenerator',
    'codeAnalysis:string, qualityScore:number -> codeReview:string'
  )
  .e('codeAnalyzer', (s) => ({ sourceCode: s.codeSnippet }))
  .e('reviewGenerator', (s) => ({
    codeAnalysis: s.codeAnalyzerResult.codeAnalysis,
    qualityScore: s.codeAnalyzerResult.qualityScore,
  }))
  .m((s) => ({ review: s.reviewGeneratorResult.codeReview }))

// Branch example - Content moderation system
const flowBranch = new AxFlow<
  { userPost: string; postType: string },
  { moderationAction: string }
>()
  .node(
    'socialMediaModerator',
    'postContent:string -> moderationDecision:string, reasoning:string'
  )
  .node(
    'forumModerator',
    'postContent:string -> moderationDecision:string, reasoning:string'
  )
  .branch((state) => state.postType)
  .when('social')
  .execute('socialMediaModerator', (state) => ({ postContent: state.userPost }))
  .when('forum')
  .execute('forumModerator', (state) => ({ postContent: state.userPost }))
  .merge()
  .map((state) => ({
    moderationAction:
      state.socialMediaModeratorResult?.moderationDecision ??
      state.forumModeratorResult?.moderationDecision ??
      'No decision made',
  }))

// Parallel example - Research paper analysis
const flowParallel = new AxFlow<
  { paperAbstract: string },
  { combinedScore: number }
>()
  .node('noveltyScorer', 'researchAbstract:string -> noveltyScore:number')
  .node('clarityScorer', 'researchAbstract:string -> clarityScore:number')
  .parallel([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (subFlow: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subFlow.execute('noveltyScorer', (state: any) => ({
        researchAbstract: state.paperAbstract,
      })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (subFlow: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subFlow.execute('clarityScorer', (state: any) => ({
        researchAbstract: state.paperAbstract,
      })),
  ])
  .merge('combinedScore', (noveltyRes: unknown, clarityRes: unknown) => {
    const noveltyResult = noveltyRes as { noveltyScore: number }
    const clarityResult = clarityRes as { clarityScore: number }
    const noveltyScore = Number(noveltyResult.noveltyScore) || 0
    const clarityScore = Number(clarityResult.clarityScore) || 0
    return (noveltyScore + clarityScore) / 2
  })

// While example - Iterative writing improvement
const flowWhile = new AxFlow<
  { draftArticle: string },
  { finalArticle: string }
>()
  .node(
    'qualityEvaluator',
    'articleDraft:string -> qualityScore:number, feedback:string'
  )
  .node(
    'articleImprover',
    'articleDraft:string, improvementFeedback:string -> improvedArticle:string'
  )
  .map((state) => ({ currentDraft: state.draftArticle, iterationCount: 0 }))
  .while((state) => state.iterationCount < 3)
  .execute('qualityEvaluator', (state) => ({
    articleDraft: state.currentDraft,
  }))
  .execute('articleImprover', (state) => ({
    articleDraft: state.currentDraft,
    improvementFeedback: state.qualityEvaluatorResult.feedback,
  }))
  .map((state) => ({
    currentDraft: state.articleImproverResult.improvedArticle,
    iterationCount: state.iterationCount + 1,
  }))
  .endWhile()
  .map((state) => ({ finalArticle: state.currentDraft }))

// Multi-hop RAG example - Research question answering (simplified)
const flowRAG = new AxFlow<
  { researchQuestion: string },
  { finalAnswer: string }
>()
  .node('queryGenerator', 'researchQuestion:string -> searchQuery:string')
  .node('retriever', 'searchQuery:string -> retrievedDocument:string')
  .node(
    'answerGenerator',
    'retrievedDocument:string, researchQuestion:string -> answer:string'
  )
  .execute('queryGenerator', (state) => ({
    researchQuestion: state.researchQuestion,
  }))
  .execute('retriever', (state) => ({
    searchQuery: state.queryGeneratorResult.searchQuery,
  }))
  .execute('answerGenerator', (state) => ({
    retrievedDocument: state.retrieverResult.retrievedDocument,
    researchQuestion: state.researchQuestion,
  }))
  .map((state) => ({ finalAnswer: state.answerGeneratorResult.answer }))

console.log('=== Document Analysis Pipeline ===')
const resultFull = await flowFull.forward(ai, {
  documentContent:
    'This is a sample business document about quarterly earnings.',
})
console.log('Document analysis complete:', resultFull)

console.log('\n=== Customer Support Ticket Processing ===')
const resultAlias1 = await flowAlias1.forward(ai, {
  ticketMessage: 'My order is delayed and I need urgent help!',
})
console.log('Support ticket processed:', resultAlias1)

console.log('\n=== Code Review System ===')
const resultAlias2 = await flowAlias2.forward(ai, {
  codeSnippet: 'function add(a, b) { return a + b; }',
})
console.log('Code review complete:', resultAlias2)

console.log('\n=== Content Moderation System ===')
const resultBranch = await flowBranch.forward(ai, {
  userPost: 'Great product recommendation!',
  postType: 'social',
})
console.log('Moderation decision:', resultBranch)

console.log('\n=== Research Paper Analysis ===')
const resultParallel = await flowParallel.forward(ai, {
  paperAbstract:
    'This paper presents a novel approach to machine learning optimization.',
})
console.log('Paper scoring complete:', resultParallel)

console.log('\n=== Iterative Writing Improvement ===')
const resultWhile = await flowWhile.forward(ai, {
  draftArticle: 'AI is changing the world in many ways.',
})
console.log('Writing improvement complete:', resultWhile)

console.log('\n=== Multi-hop RAG Research ===')
const resultRAG = await flowRAG.forward(ai, {
  researchQuestion:
    'What are the latest developments in quantum computing applications?',
})
console.log('Research complete:', resultRAG)
