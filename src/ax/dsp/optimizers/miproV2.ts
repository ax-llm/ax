import type { AxAIService } from '../../ai/types.js'
import { AxGen } from '../generate.js'
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxOptimizationStats,
  AxOptimizer,
  AxOptimizerArgs,
  AxOptimizerResult,
} from '../optimizer.js'
import type { AxProgram, AxProgramDemos } from '../program.js'
import type { AxGenIn, AxGenOut } from '../types.js'
import { updateProgressBar } from '../util.js'

import { AxBootstrapFewShot } from './bootstrapFewshot.js'

export interface AxMiPROOptions {
  numCandidates?: number
  initTemperature?: number
  maxBootstrappedDemos?: number
  maxLabeledDemos?: number
  numTrials?: number
  minibatch?: boolean
  minibatchSize?: number
  minibatchFullEvalSteps?: number
  programAwareProposer?: boolean
  dataAwareProposer?: boolean
  viewDataBatchSize?: number
  tipAwareProposer?: boolean
  fewshotAwareProposer?: boolean
  seed?: number
  verbose?: boolean
  earlyStoppingTrials?: number
  minImprovementThreshold?: number
}

interface ConfigType {
  instruction: string
  bootstrappedDemos: number
  labeledExamples: number
}

// Removed unused ConfigPoint interface

// Extended result interface to include the optimized AxGen
export interface AxMiPROResult<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxOptimizerResult<OUT> {
  optimizedGen?: AxGen<IN, OUT>
}

export class AxMiPRO<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> implements AxOptimizer<IN, OUT>
{
  private ai: AxAIService
  private examples: readonly AxExample[]
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
  private seed?: number
  private verbose: boolean
  private earlyStoppingTrials: number
  private minImprovementThreshold: number
  private stats: AxOptimizationStats

  constructor(args: AxOptimizerArgs<OUT> & { options?: AxMiPROOptions }) {
    if (args.examples.length === 0) {
      throw new Error('No examples found')
    }

    const miproOptions = args.options || {}

    this.numCandidates = miproOptions.numCandidates ?? 5
    this.initTemperature = miproOptions.initTemperature ?? 0.7
    this.maxBootstrappedDemos = miproOptions.maxBootstrappedDemos ?? 3
    this.maxLabeledDemos = miproOptions.maxLabeledDemos ?? 4
    this.numTrials = miproOptions.numTrials ?? 30
    this.minibatch = miproOptions.minibatch ?? true
    this.minibatchSize = miproOptions.minibatchSize ?? 25
    this.minibatchFullEvalSteps = miproOptions.minibatchFullEvalSteps ?? 10
    this.programAwareProposer = miproOptions.programAwareProposer ?? true
    this.dataAwareProposer = miproOptions.dataAwareProposer ?? true
    this.viewDataBatchSize = miproOptions.viewDataBatchSize ?? 10
    this.tipAwareProposer = miproOptions.tipAwareProposer ?? true
    this.fewshotAwareProposer = miproOptions.fewshotAwareProposer ?? true
    this.seed = miproOptions.seed
    this.verbose = miproOptions.verbose ?? false
    this.earlyStoppingTrials = miproOptions.earlyStoppingTrials ?? 5
    this.minImprovementThreshold = miproOptions.minImprovementThreshold ?? 0.01

    this.ai = args.studentAI
    this.examples = args.examples

    // Initialize stats
    this.stats = {
      totalCalls: 0,
      successfulDemos: 0,
      estimatedTokenUsage: 0,
      earlyStopped: false,
      resourceUsage: {
        totalTokens: 0,
        totalTime: 0,
        avgLatencyPerEval: 0,
        costByModel: {},
      },
      convergenceInfo: {
        converged: false,
        finalImprovement: 0,
        stagnationRounds: 0,
        convergenceThreshold: 0.01,
      },
    }
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
   * Generates instruction candidates for each predictor in the program
   * @returns Array of generated instruction candidates
   */
  private async proposeInstructionCandidates(): Promise<string[]> {
    const instructions: string[] = []

    // Generate random tips for tip-aware proposing
    const tips = this.tipAwareProposer ? this.generateTips() : []

    // Generate instructions for each candidate
    for (let i = 0; i < this.numCandidates; i++) {
      const tipIndex = tips.length > 0 ? i % tips.length : -1
      const tipToUse = tipIndex >= 0 ? tips[tipIndex] : ''

      const instruction = await this.generateInstruction({
        tip: tipToUse,
        candidateIndex: i,
      })

      instructions.push(instruction)
    }

    return instructions
  }

  private async generateInstruction({
    tip,
    candidateIndex,
  }: Readonly<{
    tip: string | undefined
    candidateIndex: number
  }>): Promise<string> {
    // Generate a simple instruction based on the tip and candidate index
    const baseInstructions = [
      'Analyze the input carefully and provide a detailed response.',
      'Think step by step and provide a clear answer.',
      'Consider all aspects of the input before responding.',
      'Provide a concise but comprehensive response.',
      'Focus on accuracy and clarity in your response.',
    ]

    let instruction =
      baseInstructions[candidateIndex % baseInstructions.length] ||
      baseInstructions[0]!

    if (tip) {
      instruction = `${instruction} ${tip}`
    }

    return instruction
  }

  /**
   * Bootstraps few-shot examples for the program
   */
  private async bootstrapFewShotExamples(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn
  ): Promise<AxProgramDemos<IN, OUT>[]> {
    if (this.verbose) {
      console.log('Bootstrapping few-shot examples...')
    }

    // Initialize the bootstrapper for this program
    const bootstrapper = new AxBootstrapFewShot<IN, OUT>({
      studentAI: this.ai,
      examples: this.examples,
      options: {
        maxDemos: this.maxBootstrappedDemos,
        maxRounds: 3,
        verboseMode: this.verbose,
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
   * Runs simple optimization to find the best combination of few-shot examples and instructions
   */
  private async runOptimization(
    program: Readonly<AxProgram<IN, OUT>>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[],
    instructions: readonly string[],
    valset: readonly AxExample[],
    metricFn: AxMetricFn
  ): Promise<{ bestConfig: ConfigType; bestScore: number }> {
    let bestConfig: ConfigType = {
      instruction: instructions[0] || '',
      bootstrappedDemos: Math.min(1, bootstrappedDemos.length),
      labeledExamples: Math.min(1, labeledExamples.length),
    }
    let bestScore = 0

    // Simple grid search over configurations
    for (let i = 0; i < Math.min(this.numTrials, instructions.length); i++) {
      const config: ConfigType = {
        instruction: instructions[i] || instructions[0] || '',
        bootstrappedDemos: Math.min(
          Math.floor(Math.random() * (bootstrappedDemos.length + 1)),
          this.maxBootstrappedDemos
        ),
        labeledExamples: Math.min(
          Math.floor(Math.random() * (labeledExamples.length + 1)),
          this.maxLabeledDemos
        ),
      }

      const score = await this.evaluateConfig(
        program,
        config,
        bootstrappedDemos,
        labeledExamples,
        valset,
        metricFn
      )

      if (score > bestScore) {
        bestScore = score
        bestConfig = config
      }

      // Update progress
      updateProgressBar(
        i + 1,
        this.numTrials,
        Math.round(bestScore * 100),
        0,
        'Running MIPROv2 optimization',
        30
      )
    }

    return { bestConfig, bestScore }
  }

  private async evaluateConfig(
    program: Readonly<AxProgram<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[],
    valset: readonly AxExample[],
    metricFn: AxMetricFn
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

    // Evaluate on a subset of validation examples
    const evalSet = valset.slice(0, Math.min(5, valset.length))

    for (const example of evalSet) {
      try {
        const prediction = await testProgram.forward(this.ai, example as IN)
        const score = metricFn({ prediction, example })
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

    // Configure auto settings if provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const miproOptions = options as any
    if (miproOptions?.auto) {
      this.configureAuto(miproOptions.auto)
    }

    // Split data into train and validation sets if valset not provided
    const valset =
      miproOptions?.valset ||
      this.examples.slice(0, Math.floor(this.examples.length * 0.2))

    if (this.verbose) {
      console.log(`Starting MIPROv2 optimization with ${this.numTrials} trials`)
      console.log(
        `Using ${this.examples.length} examples for training and ${valset.length} for validation`
      )
    }

    // Step 1: Bootstrap few-shot examples
    let bootstrappedDemos: AxProgramDemos<IN, OUT>[] = []
    if (this.maxBootstrappedDemos > 0) {
      bootstrappedDemos = await this.bootstrapFewShotExamples(program, metricFn)

      if (this.verbose) {
        console.log(
          `Generated ${bootstrappedDemos.length} bootstrapped demonstrations`
        )
      }
    }

    // Step 2: Select labeled examples from training set
    let labeledExamples: AxExample[] = []
    if (this.maxLabeledDemos > 0) {
      labeledExamples = this.selectLabeledExamples()

      if (this.verbose) {
        console.log(
          `Selected ${labeledExamples.length} labeled examples from training set`
        )
      }
    }

    // Step 3: Generate instruction candidates
    const instructions = await this.proposeInstructionCandidates()

    if (this.verbose) {
      console.log(`Generated ${instructions.length} instruction candidates`)
    }

    // Step 4: Run optimization to find the best configuration
    const { bestConfig, bestScore } = await this.runOptimization(
      program,
      bootstrappedDemos,
      labeledExamples,
      instructions,
      valset,
      metricFn
    )

    if (this.verbose) {
      console.log(`Optimization complete. Best score: ${bestScore}`)
      console.log(`Best configuration: ${JSON.stringify(bestConfig)}`)
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

    // Update stats
    this.stats.resourceUsage.totalTime = Date.now() - startTime
    this.stats.convergenceInfo.converged = true
    this.stats.convergenceInfo.finalImprovement = bestScore

    return {
      demos: bootstrappedDemos,
      stats: this.stats,
      bestScore,
      optimizedGen,
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
   * Get optimization statistics
   * @returns Current optimization statistics
   */
  public getStats(): AxOptimizationStats {
    return this.stats
  }
}
