import type { AxAIService } from '../../ai/types.js'
import { AxGen } from '../generate.js'
import {
  AxBaseOptimizer,
  type AxCompileOptions,
  type AxExample,
  type AxMetricFn,
  type AxMiPROCompileOptions,
  type AxMiPROOptimizerOptions,
  type AxOptimizerArgs,
  type AxOptimizerResult,
} from '../optimizer.js'
import type {
  AxProgram,
  AxProgramDemos,
  AxResultPickerFunction,
} from '../program.js'
import type { AxGenIn, AxGenOut } from '../types.js'
import { updateProgressBar } from '../util.js'

import { AxBootstrapFewShot } from './bootstrapFewshot.js'

interface ConfigType extends Record<string, unknown> {
  instruction: string
  bootstrappedDemos: number
  labeledExamples: number
}

// Extended result interface to include the optimized AxGen
export interface AxMiPROResult<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxOptimizerResult<OUT> {
  optimizedGen?: AxGen<IN, OUT>
}

export class AxMiPRO<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> extends AxBaseOptimizer<IN, OUT> {
  // MiPRO-specific options
  private maxBootstrappedDemos: number
  private maxLabeledDemos: number
  private numCandidates: number
  private initTemperature: number
  private numTrials: number
  private minibatch: boolean
  private minibatchSize: number
  private minibatchFullEvalSteps: number
  private programAwareProposer: boolean
  private dataAwareProposer: boolean
  private viewDataBatchSize: number
  private tipAwareProposer: boolean
  private fewshotAwareProposer: boolean
  private earlyStoppingTrials: number
  private minImprovementThreshold: number
  private bayesianOptimization: boolean
  private acquisitionFunction:
    | 'expected_improvement'
    | 'upper_confidence_bound'
    | 'probability_improvement'
  private explorationWeight: number

  // Self-consistency / multiple sampling
  private sampleCount: number

  // Surrogate model state for Bayesian optimization
  private miproConfigHistory: { config: ConfigType; score: number }[] = []
  private surrogateModel: Map<string, { mean: number; variance: number }> =
    new Map()

  constructor(
    args: Readonly<AxOptimizerArgs & { options?: AxMiPROOptimizerOptions }>
  ) {
    // Call parent constructor with base args
    super(args)

    const options = args.options || {}

    // MiPRO-specific options with proper defaults
    this.numCandidates = options.numCandidates ?? 5
    this.initTemperature = options.initTemperature ?? 0.7
    this.maxBootstrappedDemos = options.maxBootstrappedDemos ?? 3
    this.maxLabeledDemos = options.maxLabeledDemos ?? 4
    this.numTrials = options.numTrials ?? 30
    this.minibatch = options.minibatch ?? true
    this.minibatchSize = options.minibatchSize ?? 25
    this.minibatchFullEvalSteps = options.minibatchFullEvalSteps ?? 10
    this.programAwareProposer = options.programAwareProposer ?? true
    this.dataAwareProposer = options.dataAwareProposer ?? true
    this.viewDataBatchSize = options.viewDataBatchSize ?? 10
    this.tipAwareProposer = options.tipAwareProposer ?? true
    this.fewshotAwareProposer = options.fewshotAwareProposer ?? true
    this.earlyStoppingTrials = options.earlyStoppingTrials ?? 5
    this.minImprovementThreshold = options.minImprovementThreshold ?? 0.01
    this.bayesianOptimization = options.bayesianOptimization ?? false
    this.acquisitionFunction =
      options.acquisitionFunction ?? 'expected_improvement'
    this.explorationWeight = options.explorationWeight ?? 0.1

    // Self-consistency options
    this.sampleCount = options.sampleCount ?? 1

    // Update convergence threshold in stats
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold
  }

  /**
   * Configures the optimizer for light, medium, or heavy optimization
   * @param level The optimization level: "light", "medium", or "heavy"
   */
  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    switch (level) {
      case 'light':
        this.numCandidates = 3
        this.numTrials = 10
        this.minibatch = true
        this.minibatchSize = 20
        break
      case 'medium':
        this.numCandidates = 5
        this.numTrials = 20
        this.minibatch = true
        this.minibatchSize = 25
        break
      case 'heavy':
        this.numCandidates = 7
        this.numTrials = 30
        this.minibatch = true
        this.minibatchSize = 30
        break
    }
  }

  /**
   * Generates creative tips for instruction generation
   */
  private generateTips(): string[] {
    return [
      'Be very specific and detailed in your instructions.',
      'Focus on step-by-step reasoning in your instructions.',
      'Provide clear constraints and guidelines in your instructions.',
      'Keep your instructions concise and to the point.',
      'Emphasize accuracy and precision in your instructions.',
      'Include examples of good outputs in your instructions.',
      'Focus on handling edge cases in your instructions.',
      'Explicitly outline the reasoning process in your instructions.',
    ]
  }

  /**
   * Generates program summary for context-aware instruction generation
   */
  private async generateProgramSummary(
    program: Readonly<AxProgram<IN, OUT>>,
    ai: Readonly<AxAIService>
  ): Promise<string> {
    // Extract program structure information
    const signature = program.getSignature()

    // Create program summary prompt based on paper's Appendix C.5
    const summaryPrompt = `
Analyze this language model program and provide a concise summary of its purpose and structure.

Program Signature: ${signature}

Provide a 2-3 sentence summary focusing on:
1. The main task or purpose of this program
2. The input-output relationship
3. Any special constraints or requirements

Summary:`

    try {
      const response = await ai.chat({
        chatPrompt: [{ role: 'user', content: summaryPrompt }],
      })
      if ('results' in response) {
        return (
          response.results[0]?.content?.trim() ||
          'General language model program'
        )
      }
      return 'General language model program'
    } catch {
      return 'General language model program'
    }
  }

  /**
   * Generates dataset summary for context-aware instruction generation
   */
  private async generateDatasetSummary(
    examples: readonly AxExample[],
    ai: Readonly<AxAIService>
  ): Promise<string> {
    if (examples.length === 0) return 'No examples available'

    // Sample a few examples for analysis (based on paper's approach)
    const sampleSize = Math.min(this.viewDataBatchSize, examples.length)
    const sampledExamples = examples.slice(0, sampleSize)

    // Create dataset summary prompt based on paper's Appendix C.3
    const exampleTexts = sampledExamples
      .map((ex, i) => `Example ${i + 1}: ${JSON.stringify(ex)}`)
      .join('\n')

    const summaryPrompt = `
Analyze this dataset and provide a concise summary of its characteristics.

Sample Examples:
${exampleTexts}

Provide a 2-3 sentence summary focusing on:
1. The type of data and domain
2. Common patterns or structures in the examples
3. Key challenges or requirements for processing this data

Dataset Summary:`

    try {
      const response = await ai.chat({
        chatPrompt: [{ role: 'user', content: summaryPrompt }],
      })
      if ('results' in response) {
        return response.results[0]?.content?.trim() || 'General dataset'
      }
      return 'General dataset'
    } catch {
      return 'General dataset'
    }
  }

  /**
   * Enhanced instruction generation using AI with program and data awareness
   */
  private async generateInstruction({
    tip,
    candidateIndex,
    ai,
    programSummary,
    datasetSummary,
    previousInstructions = [],
  }: Readonly<{
    tip: string | undefined
    candidateIndex: number
    ai: Readonly<AxAIService>
    programSummary?: string
    datasetSummary?: string
    previousInstructions?: string[]
  }>): Promise<string> {
    // Build context-aware instruction generation prompt based on paper
    let contextInfo = ''

    if (this.programAwareProposer && programSummary) {
      contextInfo += `\nProgram Context: ${programSummary}`
    }

    if (this.dataAwareProposer && datasetSummary) {
      contextInfo += `\nDataset Context: ${datasetSummary}`
    }

    if (this.fewshotAwareProposer && previousInstructions.length > 0) {
      contextInfo += `\nPrevious Instructions (avoid repeating): ${previousInstructions.slice(-3).join('; ')}`
    }

    // Core instruction generation prompt inspired by paper's Appendix C.1
    const instructionPrompt = `
Generate a high-quality instruction for a language model program.

${contextInfo}

${tip ? `Tip: ${tip}` : ''}

Requirements:
1. Be specific and actionable
2. Focus on accuracy and clarity
3. Consider the program's purpose and data characteristics
4. Make the instruction distinct from previous ones
5. Keep it concise but comprehensive

Generate a single, well-crafted instruction:
Instruction:`

    try {
      const response = await ai.chat({
        chatPrompt: [
          {
            role: 'user',
            content: instructionPrompt,
          },
        ],
      })

      if ('results' in response) {
        const instruction = response.results[0]?.content?.trim()
        if (instruction && instruction.length > 10) {
          return instruction
        }
      }
    } catch (error) {
      if (this.isLoggingEnabled()) {
        this.getLogger()?.(`Failed to generate AI instruction: ${error}`, {
          tags: ['optimizer', 'warning'],
        })
      }
    }

    // Fallback to enhanced templates if AI generation fails
    const enhancedTemplates = [
      'Analyze the input systematically and provide a precise, well-reasoned response.',
      'Think through this step-by-step, considering all relevant factors before responding.',
      'Examine the input carefully and generate an accurate, detailed answer.',
      'Process the information methodically and deliver a clear, comprehensive response.',
      'Consider the context thoroughly and provide a thoughtful, accurate answer.',
    ]

    let instruction =
      enhancedTemplates[candidateIndex % enhancedTemplates.length] ||
      enhancedTemplates[0]!

    if (tip) {
      instruction = `${instruction} ${tip}`
    }

    return instruction
  }

  /**
   * Generates instruction candidates using enhanced AI-powered generation
   * @param options Optional compile options that may override teacher AI
   * @returns Array of generated instruction candidates
   */
  private async proposeInstructionCandidates(
    program: Readonly<AxProgram<IN, OUT>>,
    options?: AxCompileOptions
  ): Promise<string[]> {
    const instructions: string[] = []
    const aiToUse = this.getTeacherOrStudentAI(options)

    // Generate contextual information if enabled
    let programSummary: string | undefined
    let datasetSummary: string | undefined

    if (this.programAwareProposer) {
      programSummary = await this.generateProgramSummary(program, aiToUse)
      if (this.isLoggingEnabled(options)) {
        this.getLogger(options)?.(`Program summary: ${programSummary}`, {
          tags: ['optimizer', 'config'],
        })
      }
    }

    if (this.dataAwareProposer) {
      datasetSummary = await this.generateDatasetSummary(this.examples, aiToUse)
      if (this.isLoggingEnabled(options)) {
        this.getLogger(options)?.(`Dataset summary: ${datasetSummary}`, {
          tags: ['optimizer', 'config'],
        })
      }
    }

    // Generate creative tips for tip-aware proposing
    const tips = this.tipAwareProposer ? this.generateTips() : []

    // Generate instructions for each candidate
    for (let i = 0; i < this.numCandidates; i++) {
      const tipIndex = tips.length > 0 ? i % tips.length : -1
      const tipToUse = tipIndex >= 0 ? tips[tipIndex] : undefined

      const instruction = await this.generateInstruction({
        tip: tipToUse,
        candidateIndex: i,
        ai: aiToUse,
        programSummary,
        datasetSummary,
        previousInstructions: instructions, // Pass previous instructions for diversity
      })

      instructions.push(instruction)
    }

    return instructions
  }

  /**
   * Bootstraps few-shot examples for the program
   */
  private async bootstrapFewShotExamples(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn
  ): Promise<AxProgramDemos<IN, OUT>[]> {
    if (this.isLoggingEnabled()) {
      this.getLogger()?.('Bootstrapping few-shot examples...', {
        tags: ['optimizer', 'phase'],
      })
    }

    // Initialize the bootstrapper for this program
    const bootstrapper = new AxBootstrapFewShot<IN, OUT>({
      studentAI: this.studentAI,
      examples: this.examples,
      options: {
        maxDemos: this.maxBootstrappedDemos,
        maxRounds: 3,
        verboseMode: this.isLoggingEnabled(),
      },
    })

    const result = await bootstrapper.compile(program, metricFn, {
      maxDemos: this.maxBootstrappedDemos,
    })

    return (result.demos || []) as AxProgramDemos<IN, OUT>[]
  }

  /**
   * Selects labeled examples directly from the training set
   */
  private selectLabeledExamples(): AxExample[] {
    const selectedExamples: AxExample[] = []

    // Random sampling from the training set
    const indices = new Set<number>()
    while (
      indices.size < this.maxLabeledDemos &&
      indices.size < this.examples.length
    ) {
      const idx = Math.floor(Math.random() * this.examples.length)
      if (!indices.has(idx)) {
        indices.add(idx)
        const example = this.examples[idx]
        if (example) {
          selectedExamples.push(example)
        }
      }
    }

    return selectedExamples
  }

  /**
   * Runs optimization to find the best combination of few-shot examples and instructions
   */
  private async runOptimization(
    program: Readonly<AxProgram<IN, OUT>>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[],
    instructions: readonly string[],
    validationExamples: readonly AxExample[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<{ bestConfig: ConfigType; bestScore: number }> {
    let bestConfig: ConfigType = {
      instruction: instructions[0] || '',
      bootstrappedDemos: Math.min(1, bootstrappedDemos.length),
      labeledExamples: Math.min(1, labeledExamples.length),
    }
    let bestScore = 0
    let stagnationRounds = 0
    const scoreHistory: number[] = []

    // Check for checkpoint resume
    let startRound = 0
    if (this.resumeFromCheckpoint) {
      const checkpoint = await this.loadCheckpoint(
        this.resumeFromCheckpoint,
        options
      )
      if (checkpoint && checkpoint.optimizerType === 'MiPRO') {
        if (this.isLoggingEnabled(options)) {
          this.getLogger(options)?.(
            `Resuming from checkpoint at round ${checkpoint.currentRound}`,
            { tags: ['optimizer', 'checkpoint'] }
          )
        }

        this.restoreFromCheckpoint(checkpoint)
        startRound = checkpoint.currentRound
        bestScore = checkpoint.bestScore
        bestConfig = (checkpoint.bestConfiguration as ConfigType) || bestConfig
        stagnationRounds =
          checkpoint.stats.convergenceInfo?.stagnationRounds || 0
      }
    }

    // Optimization loop with early stopping and checkpointing
    if (this.isLoggingEnabled(options)) {
      this.getLogger(options)?.(
        `Running optimization trials (${this.numTrials} total)`,
        { tags: ['optimizer', 'phase'] }
      )
    }

    for (let i = startRound; i < this.numTrials; i++) {
      let config: ConfigType

      if (this.bayesianOptimization && this.miproConfigHistory.length > 2) {
        // Use Bayesian optimization with acquisition function
        config = await this.selectConfigurationViaBayesianOptimization(
          instructions,
          bootstrappedDemos,
          labeledExamples
        )
      } else {
        // Random or round-robin selection (exploration phase)
        config = {
          instruction:
            instructions[i % instructions.length] || instructions[0] || '',
          bootstrappedDemos: Math.min(
            Math.floor(Math.random() * (bootstrappedDemos.length + 1)),
            this.maxBootstrappedDemos
          ),
          labeledExamples: Math.min(
            Math.floor(Math.random() * (labeledExamples.length + 1)),
            this.maxLabeledDemos
          ),
        }
      }

      const score = await this.evaluateConfig(
        program,
        config,
        bootstrappedDemos,
        labeledExamples,
        validationExamples,
        metricFn,
        i + 1 // Pass current trial number for adaptive evaluation
      )

      // Update surrogate model with observed score
      this.updateSurrogateModel(config, score)

      scoreHistory.push(score)

      // Check for improvement
      const improvement = score - bestScore
      if (improvement > this.minImprovementThreshold) {
        bestScore = score
        bestConfig = config
        stagnationRounds = 0

        if (this.isLoggingEnabled(options)) {
          this.getLogger(options)?.(
            `Trial ${i + 1}/${this.numTrials}: New best score ${bestScore.toFixed(3)}`,
            { tags: ['optimizer', 'progress'] }
          )
        }
      } else {
        stagnationRounds++
      }

      // Update optimization progress with checkpointing
      await this.updateOptimizationProgress(
        i + 1,
        score,
        config,
        'MiPRO',
        this.getConfiguration(),
        bestScore,
        bestConfig,
        {
          stagnationRounds,
          bootstrappedDemos: bootstrappedDemos.length,
          labeledExamples: labeledExamples.length,
          instructions: instructions.length,
        },
        options
      )

      // Progress callback
      if (this.onProgress) {
        this.onProgress({
          round: i + 1,
          totalRounds: this.numTrials,
          currentScore: score,
          bestScore,
          tokensUsed: this.stats.resourceUsage.totalTokens,
          timeElapsed: Date.now(),
          successfulExamples: this.stats.successfulDemos,
          totalExamples: this.examples.length,
          currentConfiguration: config,
          convergenceInfo: {
            improvement,
            stagnationRounds,
            isConverging: stagnationRounds < this.earlyStoppingTrials,
          },
        })
      }

      // Update progress bar
      updateProgressBar(
        i + 1,
        this.numTrials,
        Math.round(bestScore * 100),
        0,
        'Running MIPROv2 optimization',
        30
      )

      // Cost tracking check (handles token/time/cost budgets)
      if (this.checkCostLimits()) {
        this.triggerEarlyStopping('Cost limit reached', i + 1)
        break
      }

      // Early stopping check
      if (stagnationRounds >= this.earlyStoppingTrials) {
        this.triggerEarlyStopping(
          `No improvement for ${this.earlyStoppingTrials} trials`,
          i - stagnationRounds + 1
        )
        break
      }

      // Target score check
      if (this.checkTargetScore(bestScore)) {
        this.triggerEarlyStopping(
          `Target score ${this.targetScore} reached`,
          i + 1
        )
        break
      }
    }

    // Update convergence info
    this.stats.convergenceInfo.stagnationRounds = stagnationRounds
    this.stats.convergenceInfo.finalImprovement =
      scoreHistory.length > 1 ? bestScore - scoreHistory[0]! : 0
    this.stats.convergenceInfo.converged =
      stagnationRounds < this.earlyStoppingTrials

    return { bestConfig, bestScore }
  }

  private async evaluateConfig(
    program: Readonly<AxProgram<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[],
    validationExamples: readonly AxExample[],
    metricFn: AxMetricFn,
    currentTrial: number = 0
  ): Promise<number> {
    // Create a copy of the program and apply the configuration
    const testProgram = { ...program }
    this.applyConfigToProgram(
      testProgram,
      config,
      bootstrappedDemos,
      labeledExamples
    )

    let totalScore = 0
    let count = 0

    // Adaptive minibatch size based on paper's approach
    let evalSize: number
    if (this.minibatch) {
      // Start with smaller batches and increase for more promising configurations
      const baseSize = Math.min(this.minibatchSize, validationExamples.length)

      // Use full evaluation for top configurations in later trials
      const isFullEvalTrial = currentTrial % this.minibatchFullEvalSteps === 0
      if (isFullEvalTrial || currentTrial > this.numTrials * 0.8) {
        evalSize = Math.min(validationExamples.length, baseSize * 2)
      } else {
        // Stochastic minibatch evaluation
        evalSize = Math.max(3, Math.min(baseSize, validationExamples.length))
      }
    } else {
      evalSize = validationExamples.length
    }

    // Randomly sample evaluation examples for stochastic evaluation
    const evalIndices = this.shuffleArray([
      ...Array(validationExamples.length).keys(),
    ]).slice(0, evalSize)
    const evalSet = evalIndices.map((i) => validationExamples[i]!)

    for (const example of evalSet) {
      try {
        const prediction = await testProgram.forward(
          this.studentAI,
          example as IN,
          this.sampleCount > 1
            ? {
                sampleCount: this.sampleCount,
                resultPicker:
                  axMajorityVotePicker<OUT>() as AxResultPickerFunction<AxGenOut>,
              }
            : undefined
        )
        const score = await metricFn({ prediction, example })
        totalScore += score
        count++
        this.stats.totalCalls++
      } catch {
        // Skip failed predictions
        continue
      }
    }

    return count > 0 ? totalScore / count : 0
  }

  /**
   * Fisher-Yates shuffle for stochastic evaluation
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    return shuffled
  }

  private applyConfigToProgram(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[]
  ): void {
    // Set instruction if the program supports it
    if (program.setInstruction) {
      program.setInstruction(config.instruction)
    }

    // Set demos if needed
    if (config.bootstrappedDemos > 0 && program.setDemos) {
      program.setDemos(bootstrappedDemos.slice(0, config.bootstrappedDemos))
    }

    // Set examples if needed
    if (config.labeledExamples > 0 && program.setExamples) {
      program.setExamples(labeledExamples.slice(0, config.labeledExamples))
    }
  }

  /**
   * The main compile method to run MIPROv2 optimization
   */
  public async compile(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxMiPROResult<IN, OUT>> {
    const startTime = Date.now()

    // Initialize random seed if provided
    this.setupRandomSeed()

    // Configure auto settings if provided (cast to access MiPRO-specific options)
    const miproOptions = options as AxMiPROCompileOptions
    if (miproOptions?.auto) {
      this.configureAuto(miproOptions.auto)
    }

    // Use validation set from parent class method
    const validationExamples =
      this.getValidationSet(options) ||
      (miproOptions?.validationExamples ??
        this.examples.slice(0, Math.floor(this.examples.length * 0.2)))

    if (this.isLoggingEnabled(options)) {
      this.getLogger(options)?.(
        `Starting MIPROv2 optimization with ${this.numTrials} trials`,
        { tags: ['optimizer', 'start'] }
      )
      this.getLogger(options)?.(
        `Using ${this.examples.length} examples for training and ${validationExamples.length} for validation`,
        { tags: ['optimizer', 'config'] }
      )
      if (this.teacherAI) {
        this.getLogger(options)?.(
          'Using separate teacher model for instruction generation',
          { tags: ['optimizer', 'config'] }
        )
      }
    }

    // Step 1: Bootstrap few-shot examples
    let bootstrappedDemos: AxProgramDemos<IN, OUT>[] = []
    if (this.maxBootstrappedDemos > 0) {
      bootstrappedDemos = await this.bootstrapFewShotExamples(program, metricFn)

      if (this.isLoggingEnabled(options)) {
        this.getLogger(options)?.(
          `Generated ${bootstrappedDemos.length} bootstrapped demonstrations`,
          { tags: ['optimizer', 'result'] }
        )
      }
    }

    // Step 2: Select labeled examples from training set
    let labeledExamples: AxExample[] = []
    if (this.maxLabeledDemos > 0) {
      labeledExamples = this.selectLabeledExamples()

      if (this.isLoggingEnabled(options)) {
        this.getLogger(options)?.(
          `Selected ${labeledExamples.length} labeled examples from training set`,
          { tags: ['optimizer', 'result'] }
        )
      }
    }

    // Step 3: Generate instruction candidates
    const instructions = await this.proposeInstructionCandidates(
      program,
      options
    )

    if (this.isLoggingEnabled(options)) {
      this.getLogger(options)?.(
        `Generated ${instructions.length} instruction candidates`,
        { tags: ['optimizer', 'result'] }
      )
      if (this.hasTeacherAI(options)) {
        this.getLogger(options)?.(
          'Using teacher AI for instruction generation',
          { tags: ['optimizer', 'config'] }
        )
      }
    }

    // Step 4: Run optimization to find the best configuration
    const { bestConfig, bestScore } = await this.runOptimization(
      program,
      bootstrappedDemos,
      labeledExamples,
      instructions,
      validationExamples,
      metricFn,
      options
    )

    if (this.isLoggingEnabled(options)) {
      this.getLogger(options)?.(
        `Optimization complete. Best score: ${bestScore}`,
        { tags: ['optimizer', 'complete'] }
      )
      this.getLogger(options)?.(
        `Best configuration: ${JSON.stringify(bestConfig)}`,
        { tags: ['optimizer', 'result'] }
      )
    }

    // Check if target score was reached
    if (this.checkTargetScore(bestScore)) {
      this.triggerEarlyStopping(
        `Target score ${this.targetScore} reached with score ${bestScore}`,
        this.numTrials
      )
    }

    // Create a new AxGen instance with the optimized configuration
    let signature
    if (
      'getSignature' in program &&
      typeof program.getSignature === 'function'
    ) {
      signature = program.getSignature()
    } else {
      // Fallback: create a basic signature
      signature = 'input -> output'
    }

    const optimizedGen = new AxGen<IN, OUT>(signature)

    // Apply the best configuration to the new AxGen
    this.applyConfigToAxGen(
      optimizedGen,
      bestConfig,
      bootstrappedDemos,
      labeledExamples
    )

    // Update stats using parent class method
    this.updateResourceUsage(startTime)
    this.stats.convergenceInfo.converged = true
    this.stats.convergenceInfo.finalImprovement = bestScore

    // Save final checkpoint
    await this.saveFinalCheckpoint(
      'MiPRO',
      this.getConfiguration(),
      bestScore,
      bestConfig,
      {
        bootstrappedDemos: bootstrappedDemos.length,
        labeledExamples: labeledExamples.length,
        instructions: instructions.length,
        optimizedGen: !!optimizedGen,
      },
      options
    )

    return {
      demos: bootstrappedDemos,
      stats: this.stats,
      bestScore,
      optimizedGen,
      finalConfiguration: {
        instruction: bestConfig.instruction,
        bootstrappedDemos: bestConfig.bootstrappedDemos,
        labeledExamples: bestConfig.labeledExamples,
        numCandidates: this.numCandidates,
        numTrials: this.numTrials,
        sampleCount: this.sampleCount,
      },
    }
  }

  /**
   * Applies a configuration to an AxGen instance
   */
  private applyConfigToAxGen(
    axgen: Readonly<AxGen<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[]
  ): void {
    // Set instruction if the AxGen supports it
    if (
      'setInstruction' in axgen &&
      typeof axgen.setInstruction === 'function'
    ) {
      axgen.setInstruction(config.instruction)
    }

    // Set demos if needed
    if (config.bootstrappedDemos > 0) {
      axgen.setDemos(bootstrappedDemos.slice(0, config.bootstrappedDemos))
    }

    // Set examples if needed
    if (config.labeledExamples > 0) {
      axgen.setExamples(
        labeledExamples.slice(
          0,
          config.labeledExamples
        ) as unknown as readonly (OUT & IN)[]
      )
    }
  }

  /**
   * Get optimizer-specific configuration
   * @returns Current optimizer configuration
   */
  public getConfiguration(): Record<string, unknown> {
    return {
      numCandidates: this.numCandidates,
      initTemperature: this.initTemperature,
      maxBootstrappedDemos: this.maxBootstrappedDemos,
      maxLabeledDemos: this.maxLabeledDemos,
      numTrials: this.numTrials,
      minibatch: this.minibatch,
      minibatchSize: this.minibatchSize,
      minibatchFullEvalSteps: this.minibatchFullEvalSteps,
      programAwareProposer: this.programAwareProposer,
      dataAwareProposer: this.dataAwareProposer,
      tipAwareProposer: this.tipAwareProposer,
      fewshotAwareProposer: this.fewshotAwareProposer,
      earlyStoppingTrials: this.earlyStoppingTrials,
      minImprovementThreshold: this.minImprovementThreshold,
      bayesianOptimization: this.bayesianOptimization,
      acquisitionFunction: this.acquisitionFunction,
      explorationWeight: this.explorationWeight,
      sampleCount: this.sampleCount,
    }
  }

  /**
   * Update optimizer configuration
   * @param config New configuration to merge with existing
   */
  public updateConfiguration(config: Readonly<Record<string, unknown>>): void {
    if (config.numCandidates !== undefined) {
      this.numCandidates = config.numCandidates as number
    }
    if (config.initTemperature !== undefined) {
      this.initTemperature = config.initTemperature as number
    }
    if (config.maxBootstrappedDemos !== undefined) {
      this.maxBootstrappedDemos = config.maxBootstrappedDemos as number
    }
    if (config.maxLabeledDemos !== undefined) {
      this.maxLabeledDemos = config.maxLabeledDemos as number
    }
    if (config.numTrials !== undefined) {
      this.numTrials = config.numTrials as number
    }
    if (config.minibatch !== undefined) {
      this.minibatch = config.minibatch as boolean
    }
    if (config.minibatchSize !== undefined) {
      this.minibatchSize = config.minibatchSize as number
    }
    if (config.earlyStoppingTrials !== undefined) {
      this.earlyStoppingTrials = config.earlyStoppingTrials as number
    }
    if (config.minImprovementThreshold !== undefined) {
      this.minImprovementThreshold = config.minImprovementThreshold as number
    }
    if (config.sampleCount !== undefined) {
      this.sampleCount = config.sampleCount as number
    }
    // Note: verbose is now handled by the base class and cannot be updated here
  }

  /**
   * Reset optimizer state for reuse with different programs
   */
  public override reset(): void {
    super.reset()
    // Reset surrogate model state
    this.miproConfigHistory = []
    this.surrogateModel.clear()
    // Update convergence threshold after reset
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold
  }

  /**
   * Validate that the optimizer can handle the given program
   * @param program Program to validate
   * @returns Validation result with any issues found
   */
  public override validateProgram(program: Readonly<AxProgram<IN, OUT>>): {
    isValid: boolean
    issues: string[]
    suggestions: string[]
  } {
    // Start with base validation
    const result = super.validateProgram(program)

    // Add MiPRO-specific validation
    if (
      this.examples.length <
      this.maxBootstrappedDemos + this.maxLabeledDemos
    ) {
      result.issues.push(
        `Not enough examples: need at least ${
          this.maxBootstrappedDemos + this.maxLabeledDemos
        }, got ${this.examples.length}`
      )
      result.suggestions.push(
        'Reduce maxBootstrappedDemos or maxLabeledDemos, or provide more examples'
      )
    }

    // Check if validation set is reasonable for MiPRO
    const validationSetSize = this.getValidationSet().length
    if (validationSetSize < 5) {
      result.issues.push(
        'Validation set too small for reliable MiPRO optimization'
      )
      result.suggestions.push(
        'Provide more examples or a larger validation set'
      )
    }

    return {
      isValid: result.issues.length === 0,
      issues: result.issues,
      suggestions: result.suggestions,
    }
  }

  /**
   * Encodes a configuration into a string key for surrogate model lookup
   */
  private encodeConfiguration(config: Readonly<ConfigType>): string {
    return `${config.instruction.length}_${config.bootstrappedDemos}_${config.labeledExamples}`
  }

  /**
   * Updates the surrogate model with a new configuration-score pair
   */
  private updateSurrogateModel(
    config: Readonly<ConfigType>,
    score: number
  ): void {
    this.miproConfigHistory.push({ config: { ...config }, score })

    // Simple Gaussian Process approximation for the surrogate model
    const key = this.encodeConfiguration(config)

    // Find similar configurations (same instruction length and demo counts)
    const similarConfigs = this.miproConfigHistory.filter(
      (entry) => this.encodeConfiguration(entry.config) === key
    )

    if (similarConfigs.length > 0) {
      const scores = similarConfigs.map((entry) => entry.score)
      const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length
      const variance =
        scores.length > 1
          ? scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) /
            (scores.length - 1)
          : 0.1 // Default variance for single observation

      this.surrogateModel.set(key, { mean, variance })
    }
  }

  /**
   * Predicts performance using the surrogate model
   */
  private predictPerformance(config: Readonly<ConfigType>): {
    mean: number
    variance: number
  } {
    const key = this.encodeConfiguration(config)

    if (this.surrogateModel.has(key)) {
      return this.surrogateModel.get(key)!
    }

    // For unseen configurations, use prior knowledge
    if (this.miproConfigHistory.length > 0) {
      // Find most similar configurations based on demo counts
      const similarities = this.miproConfigHistory.map((entry) => {
        const diff =
          Math.abs(entry.config.bootstrappedDemos - config.bootstrappedDemos) +
          Math.abs(entry.config.labeledExamples - config.labeledExamples)
        return { score: entry.score, similarity: 1 / (1 + diff) }
      })

      // Weighted average based on similarity
      const totalWeight = similarities.reduce((sum, s) => sum + s.similarity, 0)
      const weightedMean =
        similarities.reduce((sum, s) => sum + s.score * s.similarity, 0) /
        totalWeight

      return { mean: weightedMean, variance: 0.2 } // Higher variance for unseen configs
    }

    // Default prior for completely unknown configurations
    return { mean: 0.5, variance: 0.3 }
  }

  /**
   * Calculates acquisition function value for Bayesian optimization
   */
  private calculateAcquisitionValue(config: Readonly<ConfigType>): number {
    const prediction = this.predictPerformance(config)
    const { mean, variance } = prediction
    const std = Math.sqrt(variance)

    // Current best score
    const bestScore =
      this.miproConfigHistory.length > 0
        ? Math.max(...this.miproConfigHistory.map((entry) => entry.score))
        : 0

    switch (this.acquisitionFunction) {
      case 'expected_improvement': {
        const improvement = mean - bestScore
        if (std === 0) return Math.max(0, improvement)

        const z = improvement / std
        const phi = 0.5 * (1 + this.erf(z / Math.sqrt(2))) // CDF of standard normal
        const pdfValue = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) // PDF of standard normal

        return improvement * phi + std * pdfValue
      }

      case 'upper_confidence_bound': {
        return mean + this.explorationWeight * std
      }

      case 'probability_improvement': {
        const improvement = mean - bestScore
        if (std === 0) return improvement > 0 ? 1 : 0

        const z = improvement / std
        return 0.5 * (1 + this.erf(z / Math.sqrt(2)))
      }

      default:
        return mean
    }
  }

  /**
   * Error function approximation for acquisition function calculations
   */
  private erf(x: number): number {
    // Abramowitz and Stegun approximation
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = x >= 0 ? 1 : -1
    x = Math.abs(x)

    const t = 1.0 / (1.0 + p * x)
    const y =
      1.0 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

    return sign * y
  }

  /**
   * Selects the next configuration to evaluate using Bayesian optimization
   */
  private async selectConfigurationViaBayesianOptimization(
    instructions: readonly string[],
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[]
  ): Promise<ConfigType> {
    const candidates: Array<{ config: ConfigType; acquisitionValue: number }> =
      []

    // Generate candidate configurations
    const numCandidates = Math.min(20, instructions.length * 3) // Reasonable number of candidates

    for (let i = 0; i < numCandidates; i++) {
      const config: ConfigType = {
        instruction:
          instructions[i % instructions.length] || instructions[0] || '',
        bootstrappedDemos: Math.min(
          Math.floor(Math.random() * (bootstrappedDemos.length + 1)),
          this.maxBootstrappedDemos
        ),
        labeledExamples: Math.min(
          Math.floor(Math.random() * (labeledExamples.length + 1)),
          this.maxLabeledDemos
        ),
      }

      const acquisitionValue = this.calculateAcquisitionValue(config)
      candidates.push({ config, acquisitionValue })
    }

    // Sort by acquisition value (higher is better)
    candidates.sort((a, b) => b.acquisitionValue - a.acquisitionValue)

    // Return the most promising configuration
    return candidates[0]!.config
  }
}

// ---------------------------------------
// Helper: Majority-vote result picker for self-consistency
// ---------------------------------------
const axMajorityVotePicker = <
  OUT extends AxGenOut,
>(): AxResultPickerFunction<OUT> => {
  // Return a picker function capturing no external state
  return async (data) => {
    // If we have field results, do majority vote on stringified payload
    if (data.type === 'fields') {
      const counts: Record<string, { count: number; index: number }> = {}
      for (const { index, sample } of data.results) {
        const key = JSON.stringify(sample)
        if (!counts[key]) {
          counts[key] = { count: 0, index }
        }
        counts[key]!.count += 1
      }

      // Select the sample with highest count (ties -> first seen)
      let bestKey: string | undefined
      let bestCount = -1
      for (const [k, v] of Object.entries(counts)) {
        if (v.count > bestCount) {
          bestCount = v.count
          bestKey = k
        }
      }
      return counts[bestKey!]?.index ?? 0
    }

    // For function results, fall back to first sample (could be improved)
    return data.results[0]?.index ?? 0
  }
}
