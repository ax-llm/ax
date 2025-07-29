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
  queryFn: (query: string) => Promise<string>,
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
        searchQuery: state.originalQuestion,
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
          state.currentHop < state.maxHops &&
          state.completenessScore < state.qualityThreshold &&
          state.shouldContinue
      )
      // Increment hop counter
      .map((state) => ({
        ...state,
        currentHop: state.currentHop + 1,
      }))

      // Generate search query
      .execute('queryGenerator', (state) => ({
        originalQuestion: state.originalQuestion,
        previousContext: state.accumulatedContext || undefined,
      }))

      // Use the provided queryFn for actual retrieval
      .map(async (state) => {
        const searchQuery = state.queryGeneratorResult.searchQuery as string;
        const retrievedDocument = await queryFn(searchQuery);
        return {
          ...state,
          retrievalResult: {
            retrievedDocument,
            retrievalConfidence: 0.9, // Could extract from queryFn if supported
          },
        };
      })

      // Contextualize the retrieved document
      .execute('contextualizer', (state) => ({
        retrievedDocument: state.retrievalResult.retrievedDocument,
        accumulatedContext: state.accumulatedContext || undefined,
      }))

      // Assess the quality and completeness of current context
      .execute('qualityAssessor', (state) => ({
        currentContext: state.contextualizerResult.enhancedContext,
        originalQuestion: state.originalQuestion,
      }))

      // Update state with new information
      .map((state) => ({
        ...state,
        accumulatedContext: state.contextualizerResult.enhancedContext,
        retrievedContexts: [
          ...state.retrievedContexts,
          state.retrievalResult.retrievedDocument,
        ],
        completenessScore: state.qualityAssessorResult
          .completenessScore as number,
        searchQuery: state.queryGeneratorResult.searchQuery as string,
        shouldContinue:
          (state.qualityAssessorResult.completenessScore as number) <
          state.qualityThreshold,
      }))

      // Refine query for next iteration if needed
      .branch(
        (state) => state.shouldContinue && state.currentHop < state.maxHops
      )
      .when(true)
      .execute('queryRefiner', (state) => ({
        originalQuestion: state.originalQuestion,
        currentContext: state.accumulatedContext,
        missingAspects: state.qualityAssessorResult.missingAspects,
      }))
      .map((state) => ({
        ...state,
        searchQuery:
          state.queryRefinerResult?.refinedQuery || state.searchQuery,
      }))
      .when(false)
      .map((state) => state) // No refinement needed
      .merge()

      .endWhile()

      // Phase 2: Advanced parallel sub-query processing for complex questions
      .while(
        (state) => state.iteration < state.maxIterations && state.needsMoreInfo
      )
      .map((state) => ({
        ...state,
        iteration: state.iteration + 1,
      }))

      // First iteration: decompose the complex question
      .branch((state) => state.iteration === 1)
      .when(true)
      .execute('questionDecomposer', (state) => ({
        complexQuestion: state.originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentQueries: state.questionDecomposerResult.subQuestions,
      }))
      .when(false)
      // Use focused queries from gap analysis for subsequent iterations
      .map((state) => ({
        ...state,
        currentQueries:
          ((state as any).gapAnalyzerResult?.focusedQueries as string[]) || [],
      }))
      .merge()

      // Parallel retrieval for current set of queries
      .map(async (state) => {
        const retrievalResults = await Promise.all(
          state.currentQueries?.map((query: string) => queryFn(query)) || []
        );
        return {
          ...state,
          retrievalResults,
        };
      })

      // Synthesize evidence from current iteration
      .execute('evidenceSynthesizer', (state) => ({
        collectedEvidence: [...state.allEvidence, ...state.retrievalResults],
        originalQuestion: state.originalQuestion,
      }))

      // Analyze gaps and determine if more information is needed
      .execute('gapAnalyzer', (state) => ({
        synthesizedEvidence:
          state.evidenceSynthesizerResult.synthesizedEvidence,
        evidenceGaps: state.evidenceSynthesizerResult.evidenceGaps,
        originalQuestion: state.originalQuestion,
      }))

      // Update state with new evidence and gap analysis
      .map((state) => ({
        ...state,
        allEvidence: [...state.allEvidence, ...state.retrievalResults],
        evidenceSources: [
          ...state.evidenceSources,
          `Iteration ${state.iteration} sources`,
        ],
        needsMoreInfo: state.gapAnalyzerResult.needsMoreInfo,
        synthesizedEvidence:
          state.evidenceSynthesizerResult.synthesizedEvidence,
      }))

      .endWhile()

      // Phase 3: Generate initial comprehensive answer
      .execute('answerGenerator', (state) => ({
        finalContext:
          state.accumulatedContext ||
          state.synthesizedEvidence ||
          state.allEvidence.join('\n'),
        originalQuestion: state.originalQuestion,
      }))

      // Phase 4: Self-healing quality validation and improvement (conditional)
      .branch((state) => !state.disableQualityHealing)
      .when(true)
      .execute('qualityValidator', (state) => ({
        generatedAnswer: state.answerGeneratorResult.comprehensiveAnswer,
        userQuery: state.originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentAnswer: state.answerGeneratorResult
          .comprehensiveAnswer as string,
        currentQuality: state.qualityValidatorResult.qualityScore as number,
        currentIssues: state.qualityValidatorResult.issues as string[],
        shouldContinueHealing:
          (state.qualityValidatorResult.qualityScore as number) <
          state.qualityTarget,
      }))

      // Healing loop for quality improvement
      .while(
        (state) => state.healingAttempts < 3 && state.shouldContinueHealing
      )
      .map((state) => ({
        ...state,
        healingAttempts: state.healingAttempts + 1,
      }))

      // Use queryFn for healing retrieval
      .map(async (state) => {
        const healingQuery = `${state.originalQuestion} addressing issues: ${(state.currentIssues as string[])?.join(', ') || 'quality improvement'}`;
        const healingDocument = await queryFn(healingQuery);
        return {
          ...state,
          healingResult: { healingDocument },
        };
      })

      .execute('answerHealer', (state) => ({
        originalAnswer: state.currentAnswer,
        healingDocument: state.healingResult.healingDocument,
        issues: state.currentIssues,
      }))

      // Re-validate after healing
      .execute('qualityValidator', (state) => ({
        generatedAnswer: state.answerHealerResult.healedAnswer,
        userQuery: state.originalQuestion,
      }))
      .map((state) => ({
        ...state,
        currentAnswer: state.answerHealerResult.healedAnswer as string,
        currentQuality: state.qualityValidatorResult.qualityScore as number,
        currentIssues: state.qualityValidatorResult.issues as string[],
        shouldContinueHealing:
          (state.qualityValidatorResult.qualityScore as number) <
          state.qualityTarget,
      }))

      .endWhile()
      .when(false)
      // Skip quality healing - use answer directly from Phase 3
      .map((state) => ({
        ...state,
        currentAnswer: state.answerGeneratorResult.comprehensiveAnswer,
        currentQuality: 1.0, // Assume perfect quality when disabled
        currentIssues: [] as string[],
        shouldContinueHealing: false,
      }))
      .merge()

      // Final output mapping
      .map((state) => ({
        finalAnswer: state.currentAnswer,
        totalHops: state.currentHop,
        retrievedContexts: state.retrievedContexts,
        iterationCount: state.iteration,
        healingAttempts: state.healingAttempts,
        qualityAchieved: state.currentQuality,
      }))
  );
};

/**
 * Simple RAG implementation for basic question-answering scenarios
 *
 * @param queryFn - Function to execute search queries and return results
 * @returns AxFlow instance with basic RAG capability
 */
export const axRAG = (queryFn: (query: string) => Promise<string>) => {
  return new AxFlow<{ question: string }, { answer: string; context: string }>()
    .node(
      'answerer',
      'retrievedContext:string, userQuestion:string -> finalAnswer:string'
    )
    .map(async (state) => {
      const retrievedContext = await queryFn(state.question);
      return {
        ...state,
        retrievedContext,
      };
    })
    .execute('answerer', (state) => ({
      retrievedContext: state.retrievedContext,
      userQuestion: state.question,
    }))
    .map((state) => ({
      answer: state.answererResult.finalAnswer,
      context: state.retrievedContext,
    }));
};
