import { AxFlow } from '../flow/flow.js';

/**
 * Creates a RAG (Retrieval-Augmented Generation) flow with search and reasoning capability
 *
 * @param queryFn - Function to execute search queries and return results
 * @param options - Configuration options including maxHops
 * @returns AxFlow instance with RAG capability
 */
export const axRAG = (
  _queryFn: (query: string) => Promise<string>,
  options?: { maxHops?: number; setVisibleReasoning?: boolean }
) => {
  const _maxHops = options?.maxHops ?? 3;

  // Create a RAG implementation using AxFlow
  // This creates a flow that will handle the search and answer generation
  return new AxFlow()
    .n(
      'ragProcessor',
      '"Answer questions using iterative search and reasoning." question:string, inputContext?:string[] -> answer:string, updatedContext:string[]'
    )
    .e('ragProcessor', (state: any) => ({
      question: state.question,
      inputContext: state.context,
      queryFn: state.queryFn,
    }))
    .m((state) => ({
      answer: state.ragProcessorResult.answer as string,
      context: state.ragProcessorResult.updatedContext as string[],
    }));
};

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

  return new AxFlow<
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
    .node('queryGenerator', 'originalQuestion:string, previousContext?:string -> searchQuery:string, queryReasoning:string')
    .node('retriever', 'searchQuery:string -> retrievedDocument:string, retrievalConfidence:number')
    .node('contextualizer', 'retrievedDocument:string, accumulatedContext?:string -> enhancedContext:string')
    .node('qualityAssessor', 'currentContext:string, originalQuestion:string -> completenessScore:number, missingAspects:string[]')
    .node('questionDecomposer', 'complexQuestion:string -> subQuestions:string[], decompositionReason:string')
    .node('evidenceSynthesizer', 'collectedEvidence:string[], originalQuestion:string -> synthesizedEvidence:string, evidenceGaps:string[]')
    .node('gapAnalyzer', 'synthesizedEvidence:string, evidenceGaps:string[], originalQuestion:string -> needsMoreInfo:boolean, focusedQueries:string[]')
    .node('answerGenerator', 'finalContext:string, originalQuestion:string -> comprehensiveAnswer:string, confidenceLevel:number')
    .node('queryRefiner', 'originalQuestion:string, currentContext:string, missingAspects:string[] -> refinedQuery:string')
    .node('qualityValidator', 'generatedAnswer:string, userQuery:string -> qualityScore:number, issues:string[]')
    .node('healingRetriever', 'userQuery:string, issues?:string[] -> healingDocument:string')
    .node('answerHealer', 'originalAnswer:string, healingDocument:string, issues?:string[] -> healedAnswer:string')

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
      queryFn
    }))

    // Phase 1: Multi-hop retrieval with iterative refinement
    .while((state) => 
      state.currentHop < state.maxHops && 
      state.completenessScore < state.qualityThreshold && 
      state.shouldContinue
    )
      // Increment hop counter
      .map((state) => ({
        ...state,
        currentHop: state.currentHop + 1
      }))

      // Generate search query
      .execute('queryGenerator', (state) => ({
        originalQuestion: state.originalQuestion,
        previousContext: state.accumulatedContext || undefined
      }))

      // Use the provided queryFn for actual retrieval
      .map(async (state) => {
        const retrievedDocument = await state.queryFn(state.queryGeneratorResult.searchQuery);
        return {
          ...state,
          mockRetrievalResult: { retrievedDocument, retrievalConfidence: 0.9 }
        };
      })

      // Contextualize the retrieved document
      .execute('contextualizer', (state) => ({
        retrievedDocument: state.mockRetrievalResult.retrievedDocument,
        accumulatedContext: state.accumulatedContext || undefined
      }))

      // Assess the quality and completeness of current context
      .execute('qualityAssessor', (state) => ({
        currentContext: state.contextualizerResult.enhancedContext,
        originalQuestion: state.originalQuestion
      }))

      // Update state with new information
      .map((state) => ({
        ...state,
        accumulatedContext: state.contextualizerResult.enhancedContext,
        retrievedContexts: [...state.retrievedContexts, state.mockRetrievalResult.retrievedDocument],
        completenessScore: state.qualityAssessorResult.completenessScore,
        searchQuery: state.queryGeneratorResult.searchQuery,
        shouldContinue: state.qualityAssessorResult.completenessScore < state.qualityThreshold
      }))

      // Refine query for next iteration if needed
      .branch((state) => state.shouldContinue && state.currentHop < state.maxHops)
      .when(true)
        .execute('queryRefiner', (state) => ({
          originalQuestion: state.originalQuestion,
          currentContext: state.accumulatedContext,
          missingAspects: state.qualityAssessorResult.missingAspects
        }))
        .map((state) => ({
          ...state,
          searchQuery: state.queryRefinerResult?.refinedQuery || state.searchQuery
        }))
      .when(false)
        .map((state) => state) // No refinement needed
      .merge()

    .endWhile()

    // Phase 2: Advanced parallel sub-query processing for complex questions
    .while((state) => state.iteration < state.maxIterations && state.needsMoreInfo)
      .map((state) => ({
        ...state,
        iteration: state.iteration + 1
      }))

      // First iteration: decompose the complex question
      .branch((state) => state.iteration === 1)
      .when(true)
        .execute('questionDecomposer', (state) => ({
          complexQuestion: state.originalQuestion
        }))
        .map((state) => ({
          ...state,
          currentQueries: state.questionDecomposerResult.subQuestions
        }))
      .when(false)
        // Use focused queries from gap analysis for subsequent iterations
        .map((state) => ({
          ...state,
          currentQueries: state.gapAnalyzerResult?.focusedQueries || []
        }))
      .merge()

      // Parallel retrieval for current set of queries using provided queryFn
      .map(async (state) => {
        const retrievalPromises = state.currentQueries.map((query: string) => state.queryFn(query));
        const retrievalResults = await Promise.all(retrievalPromises);
        return {
          ...state,
          retrievalResults
        };
      })

      // Synthesize evidence from current iteration
      .execute('evidenceSynthesizer', (state) => ({
        collectedEvidence: [...state.allEvidence, ...state.retrievalResults],
        originalQuestion: state.originalQuestion
      }))

      // Analyze gaps and determine if more information is needed
      .execute('gapAnalyzer', (state) => ({
        synthesizedEvidence: state.evidenceSynthesizerResult.synthesizedEvidence,
        evidenceGaps: state.evidenceSynthesizerResult.evidenceGaps,
        originalQuestion: state.originalQuestion
      }))

      // Update state with new evidence and gap analysis
      .map((state) => ({
        ...state,
        allEvidence: [...state.allEvidence, ...state.retrievalResults],
        evidenceSources: [...state.evidenceSources, `Iteration ${state.iteration} sources`],
        needsMoreInfo: state.gapAnalyzerResult.needsMoreInfo,
        synthesizedEvidence: state.evidenceSynthesizerResult.synthesizedEvidence
      }))

    .endWhile()

    // Phase 3: Generate initial comprehensive answer
    .execute('answerGenerator', (state) => ({
      finalContext: state.accumulatedContext || state.synthesizedEvidence || state.allEvidence.join('\n'),
      originalQuestion: state.originalQuestion
    }))

    // Phase 4: Self-healing quality validation and improvement (conditional)
    .branch((state) => !state.disableQualityHealing)
    .when(true)
      .execute('qualityValidator', (state) => ({
        generatedAnswer: state.answerGeneratorResult.comprehensiveAnswer,
        userQuery: state.originalQuestion
      }))
      .map((state) => ({
        ...state,
        currentAnswer: state.answerGeneratorResult.comprehensiveAnswer,
        currentQuality: state.qualityValidatorResult.qualityScore,
        currentIssues: state.qualityValidatorResult.issues,
        shouldContinueHealing: state.qualityValidatorResult.qualityScore < state.qualityTarget
      }))

      // Healing loop for quality improvement
      .while((state) => state.healingAttempts < 3 && state.shouldContinueHealing)
        .map((state) => ({
          ...state,
          healingAttempts: state.healingAttempts + 1
        }))

        // Use queryFn for healing retrieval
        .map(async (state) => {
          const healingQuery = `Improve answer quality for: ${state.originalQuestion}. Issues: ${state.currentIssues.join(', ')}`;
          const healingDocument = await state.queryFn(healingQuery);
          return {
            ...state,
            mockHealingResult: { healingDocument }
          };
        })

        .execute('answerHealer', (state) => ({
          originalAnswer: state.currentAnswer,
          healingDocument: state.mockHealingResult.healingDocument,
          issues: state.currentIssues
        }))

        // Re-validate after healing
        .execute('qualityValidator', (state) => ({
          generatedAnswer: state.answerHealerResult.healedAnswer,
          userQuery: state.originalQuestion
        }))
        .map((state) => ({
          ...state,
          currentAnswer: state.answerHealerResult.healedAnswer,
          currentQuality: state.qualityValidatorResult.qualityScore,
          currentIssues: state.qualityValidatorResult.issues,
          shouldContinueHealing: state.qualityValidatorResult.qualityScore < state.qualityTarget
        }))

      .endWhile()
    .when(false)
      // Skip quality healing - use answer directly from Phase 3
      .map((state) => ({
        ...state,
        currentAnswer: state.answerGeneratorResult.comprehensiveAnswer,
        currentQuality: 1.0, // Assume perfect quality when disabled
        currentIssues: [] as string[],
        shouldContinueHealing: false
      }))
    .merge()

    // Final output mapping
    .map((state) => ({
      finalAnswer: state.currentAnswer,
      totalHops: state.currentHop,
      retrievedContexts: state.retrievedContexts,
      iterationCount: state.iteration,
      healingAttempts: state.healingAttempts,
      qualityAchieved: state.currentQuality
    }));
};