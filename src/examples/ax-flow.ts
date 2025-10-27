// AxFlow usage examples: full method names and aliases
import { AxAIGoogleGeminiModel, AxFlow, ai, flow } from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

// Full method example - Document analysis pipeline with production configuration
const flowFull = AxFlow.create<{ documentContent: string }>({
  autoParallel: true,
})
  .description(
    'Document Analysis Pipeline',
    'Summarizes a document, extracts keywords, and analyzes sentiment.'
  )
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
      : [];
    return {
      analysis: `Summary: ${state.summarizerResult.documentSummary}, Keywords: ${keywords.join(', ')}, Sentiment: ${state.sentimentAnalyzerResult.sentiment} (${state.sentimentAnalyzerResult.confidence})`,
    };
  });

// Aliases example 1 - Customer support ticket processing with error handling
const flowAlias1 = AxFlow.create<{ ticketMessage: string }>()
  .description(
    'Support Ticket Processor',
    'Classifies incoming support messages and generates a suggested response.'
  )
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
  .m((state) => ({ supportResponse: state.responderResult.supportResponse }));

// Aliases example 2 - Simplified code review system with auto-parallelization
const flowAlias2 = AxFlow.create<
  { codeSnippet: string },
  { codeReview: string }
>({
  autoParallel: true,
})
  .description(
    'Code Review Assistant',
    'Analyzes a code snippet and produces a concise review with quality score.'
  )
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
  .m((s) => ({ codeReview: s.reviewGeneratorResult.codeReview }));

// Branch example - Content moderation system
const flowBranch = AxFlow.create<
  { userPost: string; postType: string },
  { moderationAction: string }
>()
  .description(
    'Content Moderation Router',
    'Routes content to the appropriate moderator and returns the moderation action.'
  )
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
  }));

// Parallel example - Research paper analysis with manual parallelization
const flowParallel = flow<{ paperAbstract: string }>()
  .description(
    'Research Paper Scorer',
    'Scores novelty and clarity in parallel and computes a combined score.'
  )
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
    const noveltyResult = noveltyRes as {
      noveltyScorerResult: { noveltyScore: number };
    };
    const clarityResult = clarityRes as {
      clarityScorerResult: { clarityScore: number };
    };
    const noveltyScore =
      Number(noveltyResult.noveltyScorerResult?.noveltyScore) || 0;
    const clarityScore =
      Number(clarityResult.clarityScorerResult?.clarityScore) || 0;
    return (noveltyScore + clarityScore) / 2;
  });

// While example - Iterative writing improvement with circuit breaker
const flowWhile = AxFlow.create<{ draftArticle: string }>()
  .description(
    'Iterative Writing Improver',
    'Loops to improve article quality until the target is reached.'
  )
  .node(
    'qualityEvaluator',
    'articleDraft:string -> qualityScore:number, qualityFeedback:string'
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
    improvementFeedback: state.qualityEvaluatorResult.qualityFeedback,
  }))
  .map((state) => ({
    currentDraft: state.articleImproverResult.improvedArticle,
    iterationCount: state.iterationCount + 1,
  }))
  .endWhile()
  .map((state) => ({ finalArticle: state.currentDraft }));

// Multi-hop RAG example - Research question answering with concurrency control
const flowRAG = AxFlow.create<{ researchQuestion: string }>()
  .description(
    'Multi-hop Research QA',
    'Generates a query, retrieves context, and answers a research question.'
  )
  .node('queryGenerator', 'researchQuestion:string -> searchQuery:string')
  .node('retriever', 'searchQuery:string -> retrievedDocument:string')
  .node(
    'answerGenerator',
    'retrievedDocument:string, researchQuestion:string -> researchAnswer:string'
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
  .map((state) => ({
    finalAnswer: state.answerGeneratorResult.researchAnswer,
  }));

// Batched parallel example - Processing multiple documents with concurrency control
const flowBatchedParallel = flow<{ documentBatch: string }>()
  .description(
    'Batched Parallel Processor',
    'Processes a batch through multiple processors with limited concurrency.'
  )
  .node('processor1', 'batchData:string -> processedResult1:string')
  .node('processor2', 'batchData:string -> processedResult2:string')
  .node('processor3', 'batchData:string -> processedResult3:string')
  .parallel([
    // These 3 operations will be batched: only 2 run concurrently
    (subFlow: any) =>
      subFlow.execute('processor1', (state: any) => ({
        batchData: state.documentBatch,
      })),
    (subFlow: any) =>
      subFlow.execute('processor2', (state: any) => ({
        batchData: state.documentBatch,
      })),
    (subFlow: any) =>
      subFlow.execute('processor3', (state: any) => ({
        batchData: state.documentBatch,
      })),
  ])
  .merge('processedBatch', (res1: any, res2: any, res3: any) => {
    return `Combined: ${res1?.processor1Result?.processedResult1 || 'missing'}, ${res2?.processor2Result?.processedResult2 || 'missing'}, ${res3?.processor3Result?.processedResult3 || 'missing'}`;
  });

console.log('=== Document Analysis Pipeline ===');
const resultFull = await flowFull.forward(
  llm,
  {
    documentContent:
      'This is a sample business document about quarterly earnings.',
  },
  { debug: true }
);
console.log('Document analysis complete:', resultFull);

console.log('\n=== Customer Support Ticket Processing ===');
const resultAlias1 = await flowAlias1.forward(llm, {
  ticketMessage: 'My order is delayed and I need urgent help!',
});
console.log('Support ticket processed:', resultAlias1);

console.log('\n=== Code Review System ===');
const resultAlias2 = await flowAlias2.forward(llm, {
  codeSnippet: 'function add(a, b) { return a + b; }',
});
console.log('Code review complete:', resultAlias2);

console.log('\n=== Content Moderation System ===');
const resultBranch = await flowBranch.forward(llm, {
  userPost: 'Great product recommendation!',
  postType: 'social',
});
console.log('Moderation decision:', resultBranch);

console.log('\n=== Research Paper Analysis ===');
const resultParallel = await flowParallel.forward(llm, {
  paperAbstract:
    'This paper presents a novel approach to machine learning optimization.',
});
console.log('Paper scoring complete:', resultParallel);

console.log('\n=== Iterative Writing Improvement ===');
const resultWhile = await flowWhile.forward(llm, {
  draftArticle: 'AI is changing the world in many ways.',
});
console.log('Writing improvement complete:', resultWhile);

console.log('\n=== Multi-hop RAG Research ===');
const resultRAG = await flowRAG.forward(llm, {
  researchQuestion:
    'What are the latest developments in quantum computing applications?',
});
console.log('Research complete:', resultRAG);

console.log('\n=== Batched Parallel Processing ===');
const resultBatched = await flowBatchedParallel.forward(llm, {
  documentBatch: 'Sample document content for parallel processing',
});
console.log('Batched processing complete:', resultBatched);
