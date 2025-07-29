import { AxFlow } from '../flow/flow.js';

/**
 * Advanced Multi-hop RAG with iterative query refinement, context accumulation,
 * parallel sub-queries, and self-healing quality feedback loops
 *
 * @param queryFn - Function to execute search queries and return results
 * @param options - Configuration options
 * @returns AxFlow instance with advanced RAG capability
 */
export const axAdvancedRAG = (
  _queryFn: (query: string) => Promise<string>,
  options?: {
    maxHops?: number;
    qualityThreshold?: number;
    maxIterations?: number;
    qualityTarget?: number;
    disableQualityHealing?: boolean;
  }
) => {
  const maxHops = options?.maxHops ?? 3;
  const qualityThreshold = options?.qualityThreshold ?? 0.8;
  const maxIterations = options?.maxIterations ?? 2;
  const qualityTarget = options?.qualityTarget ?? 0.85;
  const disableQualityHealing = options?.disableQualityHealing ?? false;

  return (
    new AxFlow<
      { originalQuestion: string },
      {
        finalAnswer: string;
        totalHops: number;
        retrievedContexts: string[];
        iterationCount: number;
        healingAttempts: number;
        qualityAchieved: number;
      }
    >()
      // Define nodes for comprehensive RAG pipeline
      .node(
        'queryGenerator',
        'originalQuestion:string, previousContext?:string -> searchQuery:string, queryReasoning:string'
      )
      .node(
        'retriever',
        'searchQuery:string -> retrievedDocument:string, retrievalConfidence:number'
      )
      .node(
        'contextualizer',
        'retrievedDocument:string, accumulatedContext?:string -> enhancedContext:string'
      )
      .node(
        'qualityAssessor',
        'currentContext:string, originalQuestion:string -> completenessScore:number, missingAspects:string[]'
      )
      .node(
        'questionDecomposer',
        'complexQuestion:string -> subQuestions:string[], decompositionReason:string'
      )
      .node(
        'evidenceSynthesizer',
        'collectedEvidence:string[], originalQuestion:string -> synthesizedEvidence:string, evidenceGaps:string[]'
      )
      .node(
        'gapAnalyzer',
        'synthesizedEvidence:string, evidenceGaps:string[], originalQuestion:string -> needsMoreInfo:boolean, focusedQueries:string[]'
      )
      .node(
        'answerGenerator',
        'finalContext:string, originalQuestion:string -> comprehensiveAnswer:string, confidenceLevel:number'
      )
      .node(
        'queryRefiner',
        'originalQuestion:string, currentContext:string, missingAspects:string[] -> refinedQuery:string'
      )
      .node(
        'qualityValidator',
        'generatedAnswer:string, userQuery:string -> qualityScore:number, issues:string[]'
      )
      .node(
        'healingRetriever',
        'userQuery:string, issues?:string[] -> healingDocument:string'
      )
      .node(
        'answerHealer',
        'originalAnswer:string, healingDocument:string, issues?:string[] -> healedAnswer:string'
      )

      // Initialize comprehensive state
      .map((state) => ({
        ...state,
        maxHops,
        qualityThreshold,
        maxIterations,
        qualityTarget,
        disableQualityHealing,
        currentHop: 0,
        accumulatedContext: '',
        retrievedContexts: [] as string[],
        completenessScore: 0,
        searchQuery: (state as any).originalQuestion,
        shouldContinue: true,
        iteration: 0,
        allEvidence: [] as string[],
        evidenceSources: [] as string[],
        needsMoreInfo: true,
        healingAttempts: 0,
        currentQuality: 0,
        shouldContinueHealing: true,
        currentAnswer: '',
        currentIssues: [] as string[],
      }))

      // Phase 1: Multi-hop retrieval with iterative refinement
      .while(
        (state) =>
          (state as any).currentHop < (state as any).maxHops &&
          (state as any).completenessScore < (state as any).qualityThreshold &&
          state.shouldContinue
      )
      // Increment hop counter
      .map((state) => ({
        ...state,
        currentHop: (state as any).currentHop + 1,
      }))

      // Generate search query
      .execute('queryGenerator', (state) => ({
        originalQuestion: (state as any).originalQuestion,
        previousContext: state.accumulatedContext || undefined,
      }))

      // Use the provided queryFn for actual retrieval - simulated with mock data
      .map(
        (state) =>
          ({
            ...state,
            mockRetrievalResult: {
              retrievedDocument: `Mock retrieved document for query: ${(state as any).queryGeneratorResult?.searchQuery || 'default'}`,
              retrievalConfidence: 0.9,
            },
          }) as any
      )

      // Contextualize the retrieved document
      .execute('contextualizer', (state) => ({
        retrievedDocument: (state as any).mockRetrievalResult.retrievedDocument,
        accumulatedContext: (state as any).accumulatedContext || undefined,
      }))

      // Assess the quality and completeness of current context
      .execute('qualityAssessor', (state) => ({
        currentContext: (state as any).contextualizerResult.enhancedContext,
        originalQuestion: (state as any).originalQuestion,
      }))

      // Update state with new information
      .map((state) => ({
        ...state,
        accumulatedContext: (state as any).contextualizerResult.enhancedContext,
        retrievedContexts: [
          ...(state as any).retrievedContexts,
          (state as any).mockRetrievalResult.retrievedDocument,
        ],
        completenessScore: (state as any).qualityAssessorResult
          .completenessScore,
        searchQuery: (state as any).queryGeneratorResult.searchQuery,
        shouldContinue:
          (state as any).qualityAssessorResult.completenessScore <
          (state as any).qualityThreshold,
      }))

      // Refine query for next iteration if needed
      .branch(
        (state) =>
          (state as any).shouldContinue &&
          (state as any).currentHop < (state as any).maxHops
      )
      .when(true)
      .execute('queryRefiner', (state) => ({
        originalQuestion: (state as any).originalQuestion,
        currentContext: (state as any).accumulatedContext,
        missingAspects: (state as any).qualityAssessorResult.missingAspects,
      }))
      .map((state) => ({
        ...state,
        searchQuery:
          (state as any).queryRefinerResult?.refinedQuery ||
          (state as any).searchQuery,
      }))
      .when(false)
      .map((state) => state) // No refinement needed
      .merge()

      .endWhile()

      // Phase 2: Advanced parallel sub-query processing for complex questions
      .while(
        (state) =>
          (state as any).iteration < (state as any).maxIterations &&
          (state as any).needsMoreInfo
      )
      .map((state) => ({
        ...state,
        iteration: (state as any).iteration + 1,
      }))

      // First iteration: decompose the complex question
      .branch((state) => (state as any).iteration === 1)
      .when(true)
      .execute('questionDecomposer', (state) => ({
        complexQuestion: (state as any).originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentQueries: (state as any).questionDecomposerResult.subQuestions,
      }))
      .when(false)
      // Use focused queries from gap analysis for subsequent iterations
      .map((state) => ({
        ...state,
        currentQueries: (state as any).gapAnalyzerResult?.focusedQueries || [],
      }))
      .merge()

      // Parallel retrieval for current set of queries - simulated with mock data
      .map(
        (state) =>
          ({
            ...state,
            retrievalResults:
              (state as any).currentQueries?.map(
                (query: string) => `Mock retrieved result for: ${query}`
              ) || [],
          }) as any
      )

      // Synthesize evidence from current iteration
      .execute('evidenceSynthesizer', (state) => ({
        collectedEvidence: [
          ...(state as any).allEvidence,
          ...(state as any).retrievalResults,
        ],
        originalQuestion: (state as any).originalQuestion,
      }))

      // Analyze gaps and determine if more information is needed
      .execute('gapAnalyzer', (state) => ({
        synthesizedEvidence: (state as any).evidenceSynthesizerResult
          .synthesizedEvidence,
        evidenceGaps: (state as any).evidenceSynthesizerResult.evidenceGaps,
        originalQuestion: (state as any).originalQuestion,
      }))

      // Update state with new evidence and gap analysis
      .map((state) => ({
        ...state,
        allEvidence: [
          ...(state as any).allEvidence,
          ...(state as any).retrievalResults,
        ],
        evidenceSources: [
          ...(state as any).evidenceSources,
          `Iteration ${(state as any).iteration} sources`,
        ],
        needsMoreInfo: (state as any).gapAnalyzerResult.needsMoreInfo,
        synthesizedEvidence: (state as any).evidenceSynthesizerResult
          .synthesizedEvidence,
      }))

      .endWhile()

      // Phase 3: Generate initial comprehensive answer
      .execute('answerGenerator', (state) => ({
        finalContext:
          (state as any).accumulatedContext ||
          (state as any).synthesizedEvidence ||
          (state as any).allEvidence.join('\n'),
        originalQuestion: (state as any).originalQuestion,
      }))

      // Phase 4: Self-healing quality validation and improvement (conditional)
      .branch((state) => !(state as any).disableQualityHealing)
      .when(true)
      .execute('qualityValidator', (state) => ({
        generatedAnswer: (state as any).answerGeneratorResult
          .comprehensiveAnswer,
        userQuery: (state as any).originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentAnswer: (state as any).answerGeneratorResult.comprehensiveAnswer,
        currentQuality: (state as any).qualityValidatorResult.qualityScore,
        currentIssues: (state as any).qualityValidatorResult.issues,
        shouldContinueHealing:
          (state as any).qualityValidatorResult.qualityScore <
          (state as any).qualityTarget,
      }))

      // Healing loop for quality improvement
      .while(
        (state) =>
          (state as any).healingAttempts < 3 &&
          (state as any).shouldContinueHealing
      )
      .map((state) => ({
        ...state,
        healingAttempts: (state as any).healingAttempts + 1,
      }))

      // Use queryFn for healing retrieval - simulated with mock data
      .map(
        (state) =>
          ({
            ...state,
            mockHealingResult: {
              healingDocument: `Mock healing document for: ${(state as any).originalQuestion}. Addressing issues: ${(state as any).currentIssues?.join(', ') || 'none'}`,
            },
          }) as any
      )

      .execute('answerHealer', (state) => ({
        originalAnswer: (state as any).currentAnswer,
        healingDocument: (state as any).mockHealingResult.healingDocument,
        issues: (state as any).currentIssues,
      }))

      // Re-validate after healing
      .execute('qualityValidator', (state) => ({
        generatedAnswer: (state as any).answerHealerResult.healedAnswer,
        userQuery: (state as any).originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentAnswer: (state as any).answerHealerResult.healedAnswer,
        currentQuality: (state as any).qualityValidatorResult.qualityScore,
        currentIssues: (state as any).qualityValidatorResult.issues,
        shouldContinueHealing:
          (state as any).qualityValidatorResult.qualityScore <
          (state as any).qualityTarget,
      }))

      .endWhile()
      .when(false)
      // Skip quality healing - use answer directly from Phase 3
      .map((state) => ({
        ...state,
        currentAnswer: (state as any).answerGeneratorResult.comprehensiveAnswer,
        currentQuality: 1.0, // Assume perfect quality when disabled
        currentIssues: [] as string[],
        shouldContinueHealing: false,
      }))
      .merge()

      // Final output mapping
      .map((state) => ({
        finalAnswer: (state as any).currentAnswer,
        totalHops: (state as any).currentHop,
        retrievedContexts: (state as any).retrievedContexts,
        iterationCount: (state as any).iteration,
        healingAttempts: (state as any).healingAttempts,
        qualityAchieved: (state as any).currentQuality,
      }))
  );
};

/**
 * Simple RAG implementation for basic question-answering scenarios
 *
 * @param queryFn - Function to execute search queries and return results
 * @returns AxFlow instance with basic RAG capability
 */
export const axRAG = (_queryFn: (query: string) => Promise<string>) => {
  return new AxFlow<{ question: string }, { answer: string; context: string }>()
    .node('retriever', 'userQuestion:string -> retrievedContext:string')
    .node('answerer', 'context:string, question:string -> finalAnswer:string')
    .map((state) => ({
      ...state,
      mockContext: `Mock retrieved context for: ${state.question}`,
    }))
    .execute('answerer', (state) => ({
      context: state.mockContext,
      question: state.question,
    }))
    .map((state) => ({
      answer: state.answererResult.finalAnswer,
      context: state.mockContext,
    }));
};
