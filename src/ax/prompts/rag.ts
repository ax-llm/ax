import { flow } from '../flow/flow.js';
import type { AxFlowLoggerFunction } from '../flow/logger.js';

/**
 * Advanced Multi-hop RAG with iterative query refinement, context accumulation,
 * parallel sub-queries, and self-healing quality feedback loops
 *
 * @param queryFn - Function to execute search queries and return results
 * @param options - Configuration options
 * @returns AxFlow instance with advanced RAG capability
 */
export const axRAG = (
  queryFn: (query: string) => Promise<string>,
  options?: {
    maxHops?: number;
    qualityThreshold?: number;
    maxIterations?: number;
    qualityTarget?: number;
    disableQualityHealing?: boolean;
    logger?: AxFlowLoggerFunction;
    debug?: boolean;
  }
) => {
  const maxHops = options?.maxHops ?? 3;
  const qualityThreshold = options?.qualityThreshold ?? 0.8;
  const maxIterations = options?.maxIterations ?? 2;
  const qualityTarget = options?.qualityTarget ?? 0.85;
  const disableQualityHealing = options?.disableQualityHealing ?? false;

  return (
    flow<{ originalQuestion: string }>({
      logger: options?.logger,
      debug: options?.debug,
    })
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
        const searchQuery =
          (state.queryGeneratorResult?.searchQuery as string) ||
          state.searchQuery ||
          state.originalQuestion;
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
      // Initialize allEvidence with retrieved contexts from Phase 1
      .map((state) => ({
        ...state,
        allEvidence:
          state.retrievedContexts.length > 0 ? state.retrievedContexts : [],
      }))

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
        const queries = state.currentQueries || [];
        const retrievalResults =
          queries.length > 0
            ? await Promise.all(
                queries.filter(Boolean).map((query: string) => queryFn(query))
              )
            : [];
        return {
          ...state,
          retrievalResults,
        };
      })

      // Synthesize evidence from current iteration
      .execute('evidenceSynthesizer', (state) => {
        const priorEvidence = Array.isArray(state.allEvidence)
          ? state.allEvidence
          : [];
        const newRetrievals = Array.isArray((state as any).retrievalResults)
          ? (state as any).retrievalResults
          : [];
        const evidence = [...priorEvidence, ...newRetrievals].filter(Boolean);

        return {
          collectedEvidence:
            evidence.length > 0 ? evidence : ['No evidence collected yet'],
          originalQuestion: state.originalQuestion,
        };
      })

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
        allEvidence: [
          ...((Array.isArray(state.allEvidence)
            ? state.allEvidence
            : []) as string[]),
          ...(Array.isArray((state as any).retrievalResults)
            ? ((state as any).retrievalResults as string[])
            : []),
        ],
        evidenceSources: [
          ...((Array.isArray(state.evidenceSources)
            ? state.evidenceSources
            : []) as string[]),
          `Iteration ${state.iteration} sources`,
        ],
        needsMoreInfo: state.gapAnalyzerResult.needsMoreInfo,
        synthesizedEvidence:
          state.evidenceSynthesizerResult.synthesizedEvidence,
      }))

      .endWhile()

      // Phase 3: Generate initial comprehensive answer
      .execute('answerGenerator', (state) => ({
        finalContext: (() => {
          const fromAccumulated = (state.accumulatedContext || '')
            .toString()
            .trim();
          if (fromAccumulated.length > 0) return fromAccumulated;
          const fromSynth = (state.synthesizedEvidence || '').toString().trim();
          if (fromSynth.length > 0) return fromSynth;
          const fromAll = Array.isArray(state.allEvidence)
            ? (state.allEvidence as string[]).filter(Boolean).join('\n')
            : '';
          const fallback = fromAll.toString().trim();
          return fallback.length > 0 ? fallback : 'No context available.';
        })(),
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
        const issues = (state.currentIssues as string[]) || [];
        const healingQuery =
          issues.length > 0
            ? `${state.originalQuestion} addressing issues: ${issues.join(', ')}`
            : `${state.originalQuestion} quality improvement`;
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
      .returns((state) => ({
        finalAnswer: state.currentAnswer,
        totalHops: state.currentHop,
        retrievedContexts: state.retrievedContexts,
        iterationCount: state.iteration,
        healingAttempts: state.healingAttempts,
        qualityAchieved: state.currentQuality,
      }))
  );
};
