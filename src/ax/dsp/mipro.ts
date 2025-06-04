import type { AxAIService } from '../ai/types.js'

import {
  AxBootstrapFewShot,
  type AxExample,
  type AxMetricFn,
  type AxOptimizerArgs,
} from './optimize.js'
import type { AxGenIn, AxGenOut, AxProgram, AxProgramDemos } from './program.js'
import { updateProgressBar } from './util.js'

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

interface ConfigPoint {
  config: ConfigType
  score: number
}

export class AxMiPRO<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> {
  private ai: AxAIService
  private program: Readonly<AxProgram<IN, OUT>>
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
  private bootstrapper: AxBootstrapFewShot<IN, OUT>
  private earlyStoppingTrials: number
  private minImprovementThreshold: number

  constructor({
    ai,
    program,
    examples = [],
    options,
  }: Readonly<AxOptimizerArgs<IN, OUT>> & { options?: AxMiPROOptions }) {
    if (examples.length === 0) {
      throw new Error('No examples found')
    }

    const miproOptions = (options as AxMiPROOptions) || {}

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

    this.ai = ai
    this.program = program
    this.examples = examples

    // Initialize the bootstrapper to handle few-shot example generation
    this.bootstrapper = new AxBootstrapFewShot<IN, OUT>({
      ai,
      program,
      examples,
      options: {
        maxDemos: this.maxBootstrappedDemos,
        maxRounds: 3, // Default, or adjust based on your needs
        verboseMode: this.verbose,
      },
    })
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

    // Get a summary of the program for program-aware proposing
    let programContext = ''
    if (this.programAwareProposer) {
      programContext = await this.generateProgramSummary()
    }

    // Get a summary of the dataset for data-aware proposing
    let dataContext = ''
    if (this.dataAwareProposer) {
      dataContext = await this.generateDataSummary()
    }

    // Generate random tips for tip-aware proposing
    const tips = this.tipAwareProposer ? this.generateTips() : []

    // Generate instructions for each candidate
    for (let i = 0; i < this.numCandidates; i++) {
      const tipIndex = tips.length > 0 ? i % tips.length : -1
      const tipToUse = tipIndex >= 0 ? tips[tipIndex] : ''

      const instruction = await this.generateInstruction({
        programContext,
        dataContext,
        tip: tipToUse,
        candidateIndex: i,
      })

      instructions.push(instruction)
    }

    return instructions
  }

  /**
   * Generates a summary of the program structure for instruction proposal
   */
  private async generateProgramSummary(): Promise<string> {
    // In a real implementation, this would analyze the program's structure
    // and generate a summary of its components, signatures, etc.
    const prompt = `Summarize the following program structure. Focus on the signatures, 
      input/output fields, and the purpose of each component. Identify key components 
      that might benefit from better instructions.`

    const programStr = JSON.stringify(this.program)

    const response = await this.ai.chat({
      chatPrompt: [
        { role: 'system', content: prompt },
        { role: 'user', content: programStr },
      ],
      modelConfig: { temperature: 0.2 },
    })

    // Handle both sync and async responses
    if (response instanceof ReadableStream) {
      return ''
    }

    return response.results[0]?.content || ''
  }

  /**
   * Generates a summary of the dataset for instruction proposal
   */
  private async generateDataSummary(): Promise<string> {
    // Sample a subset of examples for analysis
    const sampleSize = Math.min(this.viewDataBatchSize, this.examples.length)
    const sample = this.examples.slice(0, sampleSize)

    const prompt = `Analyze the following dataset examples and provide a summary 
      of key patterns, input-output relationships, and any specific challenges 
      the data presents. Focus on what makes a good answer and what patterns should
      be followed.`

    const dataStr = JSON.stringify(sample)

    const response = await this.ai.chat({
      chatPrompt: [
        { role: 'system', content: prompt },
        { role: 'user', content: dataStr },
      ],
      modelConfig: { temperature: 0.2 },
    })

    // Handle both sync and async responses
    if (response instanceof ReadableStream) {
      return ''
    }

    return response.results[0]?.content || ''
  }

  /**
   * Generates a specific instruction candidate
   */
  private async generateInstruction({
    programContext,
    dataContext,
    tip,
    candidateIndex,
  }: Readonly<{
    programContext: string
    dataContext: string
    tip: string | undefined
    candidateIndex: number
  }>): Promise<string> {
    const prompt = `Create a high-quality instruction for an AI model performing the task described below.
    
    ${programContext ? `PROGRAM CONTEXT:\n${programContext}\n\n` : ''}
    ${dataContext ? `DATA CONTEXT:\n${dataContext}\n\n` : ''}
    ${tip ? `STYLE TIP: ${tip}\n\n` : ''}
    
    Your task is to craft a clear, effective instruction that will help the AI model generate
    accurate outputs for this task. Instruction #${candidateIndex + 1}/${this.numCandidates}.
    
    The instruction should be detailed enough to guide the model but not overly prescriptive
    or restrictive. Focus on what makes a good response rather than listing exact steps.
    
    INSTRUCTION:`

    const response = await this.ai.chat({
      chatPrompt: [{ role: 'user', content: prompt }],
      modelConfig: { temperature: 0.7 + 0.1 * candidateIndex },
    })

    // Handle both sync and async responses
    if (response instanceof ReadableStream) {
      return ''
    }

    return response.results[0]?.content || ''
  }

  /**
   * Bootstraps few-shot examples for the program
   */
  private async bootstrapFewShotExamples(
    metricFn: AxMetricFn
  ): Promise<AxProgramDemos[]> {
    if (this.verbose) {
      console.log('Bootstrapping few-shot examples...')
    }

    const result = await this.bootstrapper.compile(metricFn, {
      maxDemos: this.maxBootstrappedDemos,
    })

    return result.demos
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
   * Runs Bayesian optimization to find the best combination of few-shot examples and instructions
   */
  private async runBayesianOptimization(
    bootstrappedDemos: readonly AxProgramDemos[],
    labeledExamples: readonly AxExample[],
    instructions: readonly string[],
    valset: readonly AxExample[],
    metricFn: AxMetricFn
  ): Promise<{ bestConfig: ConfigType; bestScore: number }> {
    let bestConfig: ConfigType | null = null
    let bestScore = Number.NEGATIVE_INFINITY

    // Track all evaluated configurations for Bayesian optimization
    const evaluatedConfigs: ConfigPoint[] = []

    // Add a default fallback configuration in case all evaluations fail
    const defaultConfig: ConfigType = {
      instruction: instructions[0] || '',
      bootstrappedDemos: Math.min(1, bootstrappedDemos.length),
      labeledExamples: Math.min(1, labeledExamples.length),
    }

    // Track early stopping conditions
    let trialsWithoutImprovement = 0
    let lastBestScore = Number.NEGATIVE_INFINITY

    // Initial random exploration phase (to build a model)
    const initialExplorationTrials = Math.min(
      10,
      Math.floor(this.numTrials / 3)
    )

    const configs: ConfigType[] = []

    // Initial exploration - generate random configurations
    for (let i = 0; i < initialExplorationTrials; i++) {
      const instructionIndex = Math.floor(Math.random() * instructions.length)
      const instructionValue = instructions[instructionIndex] || ''

      const config: ConfigType = {
        instruction: instructionValue,
        bootstrappedDemos: Math.floor(
          Math.random() * (bootstrappedDemos.length + 1)
        ),
        labeledExamples: Math.floor(
          Math.random() * (labeledExamples.length + 1)
        ),
      }
      configs.push(config)
    }

    // Evaluate initial configurations
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i]
      if (!config) continue

      const score = await this.evaluateConfig(
        config,
        bootstrappedDemos,
        labeledExamples,
        valset,
        metricFn,
        i
      )

      evaluatedConfigs.push({ config, score })

      if (score > bestScore) {
        bestScore = score
        bestConfig = config

        if (this.verbose) {
          console.log(
            `New best configuration found with score ${bestScore} (exploration phase)`
          )
        }
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

    // Exploitation phase - use Bayesian optimization
    for (let i = configs.length; i < this.numTrials; i++) {
      // Generate a new configuration using acquisition function
      const nextConfig = this.selectNextConfiguration(
        evaluatedConfigs,
        bootstrappedDemos.length,
        labeledExamples.length,
        instructions
      )

      // Evaluate the configuration
      const score = await this.evaluateConfig(
        nextConfig,
        bootstrappedDemos,
        labeledExamples,
        valset,
        metricFn,
        i
      )

      evaluatedConfigs.push({ config: nextConfig, score })

      // Check if this is a new best configuration
      if (score > bestScore) {
        bestScore = score
        bestConfig = nextConfig

        if (this.verbose) {
          console.log(
            `New best configuration found with score ${bestScore} (exploitation phase)`
          )
        }

        // Reset early stopping counter
        trialsWithoutImprovement = 0
        lastBestScore = bestScore
      } else {
        // Check early stopping condition
        if (bestScore - lastBestScore < this.minImprovementThreshold) {
          trialsWithoutImprovement++

          if (trialsWithoutImprovement >= this.earlyStoppingTrials) {
            if (this.verbose) {
              console.log(
                `Early stopping triggered after ${i + 1} trials. No improvement for ${trialsWithoutImprovement} trials.`
              )
            }
            break
          }
        } else {
          // There was some improvement, but not enough to be the best
          lastBestScore = bestScore
          trialsWithoutImprovement = 0
        }
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

      // Run full evaluation on best config periodically
      if (
        this.minibatch &&
        i > 0 &&
        (i + 1) % this.minibatchFullEvalSteps === 0 &&
        bestConfig
      ) {
        if (this.verbose) {
          console.log(
            `Running full evaluation on best configuration at trial ${i + 1}`
          )
        }

        const fullScore = await this.fullEvaluation(
          bestConfig,
          bootstrappedDemos,
          labeledExamples,
          valset,
          metricFn
        )

        if (this.verbose) {
          console.log(`Full evaluation score: ${fullScore}`)
        }

        // Update best score based on full evaluation
        bestScore = fullScore
      }
    }

    if (!bestConfig) {
      if (this.verbose) {
        console.warn(
          'Optimization failed to find any valid configurations, using default fallback configuration'
        )
      }
      bestConfig = defaultConfig

      // Try to evaluate the default config as a last resort
      try {
        bestScore = await this.evaluateConfig(
          bestConfig,
          bootstrappedDemos,
          labeledExamples,
          valset,
          metricFn,
          this.numTrials - 1
        )
      } catch (err) {
        if (this.verbose) {
          console.error('Error evaluating default configuration:', err)
        }
        bestScore = 0 // Set a minimal score as fallback
      }
    }

    return { bestConfig, bestScore }
  }

  /**
   * Evaluates a configuration on the validation set
   */
  private async evaluateConfig(
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos[],
    labeledExamples: readonly AxExample[],
    valset: readonly AxExample[],
    metricFn: AxMetricFn,
    trialIndex: number
  ): Promise<number> {
    // Create a new instance for evaluation with proper cloning

    // Apply configuration to program
    this.applyConfigToProgram(
      this.program,
      config,
      bootstrappedDemos,
      labeledExamples
    )

    // Determine which examples to use for evaluation
    let evalSet: readonly AxExample[] = valset
    if (this.minibatch) {
      // Use minibatch for faster evaluation during trials
      const startIdx = (trialIndex * this.minibatchSize) % valset.length
      const minibatchEvalSet: AxExample[] = []
      for (let j = 0; j < this.minibatchSize; j++) {
        const idx = (startIdx + j) % valset.length
        const example = valset[idx]
        if (example) {
          minibatchEvalSet.push(example)
        }
      }
      evalSet = minibatchEvalSet
    }

    // Evaluate the configuration
    let sumOfScores = 0
    for (const example of evalSet) {
      try {
        const prediction = await this.program.forward(this.ai, example as IN)
        const score = metricFn({ prediction, example })
        sumOfScores += score
      } catch (err) {
        if (this.verbose) {
          console.error('Error evaluating example:', err)
        }
      }
    }
    if (evalSet.length === 0) return 0 // Avoid division by zero
    return sumOfScores / evalSet.length
  }

  /**
   * Run full evaluation on the entire validation set
   */
  private async fullEvaluation(
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos[],
    labeledExamples: readonly AxExample[],
    valset: readonly AxExample[],
    metricFn: AxMetricFn
  ): Promise<number> {
    this.applyConfigToProgram(
      this.program,
      config,
      bootstrappedDemos,
      labeledExamples
    )

    let sumOfScores = 0
    for (const example of valset) {
      try {
        const prediction = await this.program.forward(this.ai, example as IN)
        const score = metricFn({ prediction, example })
        sumOfScores += score
      } catch (err) {
        if (this.verbose) {
          console.error('Error evaluating example:', err)
        }
      }
    }
    if (valset.length === 0) return 0 // Avoid division by zero
    return sumOfScores / valset.length
  }

  /**
   * Implements a Bayesian-inspired selection of the next configuration to try
   * This is a simplified version using Upper Confidence Bound (UCB) strategy
   */
  private selectNextConfiguration(
    evaluatedConfigs: ConfigPoint[],
    maxBootstrappedDemos: number,
    maxLabeledExamples: number,
    instructions: readonly string[]
  ): ConfigType {
    // If we don't have many evaluations yet, use random exploration with a bias towards good configs
    if (evaluatedConfigs.length < 5) {
      const instructionIndex = Math.floor(Math.random() * instructions.length)
      return {
        instruction: instructions[instructionIndex] || '',
        bootstrappedDemos: Math.floor(
          Math.random() * (maxBootstrappedDemos + 1)
        ),
        labeledExamples: Math.floor(Math.random() * (maxLabeledExamples + 1)),
      }
    }

    // Sort configurations by score
    const sortedConfigs = [...evaluatedConfigs].sort(
      (a, b) => b.score - a.score
    )

    // Top performing configurations to learn from
    const topConfigs = sortedConfigs.slice(0, Math.min(3, sortedConfigs.length))

    // Calculate mean and variance of parameters in top configurations
    const meanBootstrappedDemos =
      topConfigs.reduce((sum, c) => sum + c.config.bootstrappedDemos, 0) /
      topConfigs.length
    const meanLabeledExamples =
      topConfigs.reduce((sum, c) => sum + c.config.labeledExamples, 0) /
      topConfigs.length

    // Get popular instructions among top performers
    const popularInstructions = topConfigs.map((c) => c.config.instruction)

    // Exploration factor decreases over time
    const explorationFactor = Math.max(
      0.2,
      1.0 - evaluatedConfigs.length / this.numTrials
    )

    // Generate a new configuration with exploitation (using learned info) + exploration (random variations)
    let newBootstrappedDemos: number
    let newLabeledExamples: number
    let newInstruction: string

    // Decide whether to exploit or explore for bootstrapped demos
    if (Math.random() < 0.7) {
      // 70% chance to exploit
      // Sample around the mean of top configs with some noise
      newBootstrappedDemos = Math.min(
        maxBootstrappedDemos,
        Math.max(
          0,
          Math.round(
            meanBootstrappedDemos +
              (Math.random() * 2 - 1) * explorationFactor * 2
          )
        )
      )
    } else {
      // Random exploration
      newBootstrappedDemos = Math.floor(
        Math.random() * (maxBootstrappedDemos + 1)
      )
    }

    // Same for labeled examples
    if (Math.random() < 0.7) {
      newLabeledExamples = Math.min(
        maxLabeledExamples,
        Math.max(
          0,
          Math.round(
            meanLabeledExamples +
              (Math.random() * 2 - 1) * explorationFactor * 2
          )
        )
      )
    } else {
      newLabeledExamples = Math.floor(Math.random() * (maxLabeledExamples + 1))
    }

    // For instructions, either pick from top performers or try a new one
    if (Math.random() < 0.7 && popularInstructions.length > 0) {
      const idx = Math.floor(Math.random() * popularInstructions.length)
      newInstruction = popularInstructions[idx] || ''
    } else {
      const idx = Math.floor(Math.random() * instructions.length)
      newInstruction = instructions[idx] || ''
    }

    return {
      instruction: newInstruction,
      bootstrappedDemos: newBootstrappedDemos,
      labeledExamples: newLabeledExamples,
    }
  }

  /**
   * Applies a configuration to a program instance
   */
  private applyConfigToProgram(
    program: Readonly<AxProgram<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos[],
    labeledExamples: readonly AxExample[]
  ): void {
    // Set instruction
    this.setInstructionToProgram(program, config.instruction)

    // Set demos if needed
    if (config.bootstrappedDemos > 0) {
      program.setDemos(bootstrappedDemos.slice(0, config.bootstrappedDemos))
    }

    // Set examples if needed
    if (config.labeledExamples > 0) {
      program.setExamples(labeledExamples.slice(0, config.labeledExamples))
    }
  }

  /**
   * Sets instruction to a program
   * Note: Workaround since setInstruction may not be available directly
   */
  private setInstructionToProgram(
    program: Readonly<AxProgram<IN, OUT>>,
    instruction: string
  ): void {
    // This is a simplification - in real use, you need the actual method signature
    // For demonstration purposes only
    // Usually would be: program.setInstruction(instruction)
    const programWithInstruction = program as Readonly<
      AxProgram<IN, OUT> & { setInstruction: (instr: string) => void }
    >
    programWithInstruction.setInstruction?.(instruction)
  }

  /**
   * The main compile method to run MIPROv2 optimization
   * @param metricFn Evaluation metric function
   * @param options Optional configuration options
   * @returns The optimized program
   */
  public async compile(
    metricFn: AxMetricFn,
    options?: Readonly<{
      valset?: readonly AxExample[]
      teacher?: Readonly<AxProgram<IN, OUT>>
      auto?: 'light' | 'medium' | 'heavy'
    }>
  ): Promise<Readonly<AxProgram<IN, OUT>>> {
    // Configure auto settings if provided
    if (options?.auto) {
      this.configureAuto(options.auto)
    }

    // Split data into train and validation sets if valset not provided
    const trainset = this.examples
    const valset =
      options?.valset ||
      this.examples.slice(0, Math.floor(this.examples.length * 0.8))

    if (this.verbose) {
      console.log(`Starting MIPROv2 optimization with ${this.numTrials} trials`)
      console.log(
        `Using ${trainset.length} examples for training and ${valset.length} for validation`
      )
    }

    // If teacher is provided, use it to help bootstrap examples
    if (options?.teacher) {
      if (this.verbose) {
        console.log('Using provided teacher to assist with bootstrapping')
      }

      // Create a copy of the bootstrapper with the teacher AI
      const bootstrapperWithTeacher = new AxBootstrapFewShot<IN, OUT>({
        ai: this.ai,
        program: this.program,
        examples: this.examples,
        options: {
          maxDemos: this.maxBootstrappedDemos,
          maxRounds: 3,
          verboseMode: this.verbose,
          teacherAI: this.ai, // Use the same AI but with the teacher program
        },
      })

      // Replace the existing bootstrapper
      this.bootstrapper = bootstrapperWithTeacher
    }

    // Step 1: Bootstrap few-shot examples
    let bootstrappedDemos: AxProgramDemos[] = []
    if (this.maxBootstrappedDemos > 0) {
      bootstrappedDemos = await this.bootstrapFewShotExamples(metricFn)

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

    // Step 4: Run Bayesian optimization to find the best configuration
    const { bestConfig, bestScore } = await this.runBayesianOptimization(
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

    // Apply the best configuration to a fresh copy of the program
    this.applyConfigToProgram(
      this.program,
      bestConfig,
      bootstrappedDemos,
      labeledExamples
    )

    return this.program
  }
}
