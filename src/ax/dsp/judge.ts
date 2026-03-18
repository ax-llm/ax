/**
 * AxJudge - Polymorphic & Relativistic Evaluation Engine
 *
 * Unlike traditional metrics that rely on brittle assertions or "Gold Standard" datasets,
 * AxJudge dynamically adapts its evaluation strategy based on available data.
 *
 * Key insight from "Escaping the Verifier" (RARO): It is easier and more robust for an LLM
 * to compare two answers (Relativistic) than to assign an absolute score to one.
 *
 * Three Evaluation Modes:
 * 1. **Absolute Mode** - When ground truth is available (unit test style)
 * 2. **Relativistic Mode** - Compare student vs teacher output (RARO adversarial check)
 * 3. **Reference-Free Mode** - Heuristic quality check when no comparison data exists
 */

import type { AxAIService } from '../ai/types.js';
import type { AxMetricFn, AxMetricFnArgs } from './common_types.js';
import { AxGen } from './generate.js';
import type { AxField, AxSignature } from './sig.js';
import type { AxGenIn, AxGenOut, AxProgramForwardOptions } from './types.js';

/**
 * Evaluation mode used by the judge.
 */
export type AxJudgeMode = 'absolute' | 'relativistic' | 'reference-free';

/**
 * Result from a single evaluation.
 */
export interface AxJudgeResult {
  /** Score from 0 to 1 */
  score: number;
  /** Explanation for the score */
  reasoning: string;
  /** Which evaluation mode was used */
  mode: AxJudgeMode;
  /** Winner in relativistic mode */
  winner?: 'student' | 'teacher' | 'tie';
  /** Quality tier in reference-free mode */
  qualityTier?: string;
}

/**
 * Configuration for AxJudge.
 */
export interface AxJudgeOptions {
  /** AI service to use for judging (should be >= student model quality) */
  ai: AxAIService;
  /** Custom criteria for reference-free evaluation */
  criteria?: string;
  /** Additional judge-specific guidance appended to the evaluation prompt */
  description?: string;
  /** Whether to randomize A/B position in relativistic mode to reduce bias */
  randomizeOrder?: boolean;
}

export type AxJudgeForwardOptions = Omit<
  AxProgramForwardOptions<string>,
  'functions' | 'description'
>;

export interface AxJudgeOptions extends AxJudgeForwardOptions {}

// Predefined rubrics for backward compatibility
export type AxJudgeRubric =
  | 'accuracy'
  | 'helpfulness'
  | 'relevance'
  | 'clarity'
  | 'completeness'
  | 'safety'
  | 'custom';

/**
 * Build a description of the fields for the judge prompt.
 */
function describeFields(fields: readonly AxField[]): string {
  return fields
    .map((f) => {
      const typeName = f.type?.name ?? 'string';
      const desc = f.description ? `: ${f.description}` : '';
      return `- ${f.name} (${typeName})${desc}`;
    })
    .join('\n');
}

/**
 * Check if two values are equal for absolute comparison.
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;

  // Deep comparison for objects/arrays
  if (typeof a === 'object' && a !== null && b !== null) {
    const aStr = JSON.stringify(a);
    const bStr = JSON.stringify(b);
    return aStr === bStr;
  }

  return false;
}

/**
 * Check if we can use absolute comparison (exact match).
 */
function canUseAbsoluteComparison(expected: unknown): boolean {
  if (expected === null || expected === undefined) return false;

  // Simple types can be compared directly
  if (
    typeof expected === 'string' ||
    typeof expected === 'number' ||
    typeof expected === 'boolean'
  ) {
    return true;
  }

  // Arrays of primitives
  if (Array.isArray(expected) && expected.every((v) => typeof v !== 'object')) {
    return true;
  }

  return false;
}

/**
 * AxJudge - Polymorphic evaluation engine that automatically selects the best strategy.
 *
 * @example
 * ```typescript
 * const judge = new AxJudge(signature, { ai: teacherAI });
 *
 * // Absolute mode (with ground truth)
 * const result1 = await judge.evaluate(
 *   { question: 'Capital of France?' },
 *   { answer: 'Paris' },
 *   { answer: 'Paris' }  // expected
 * );
 *
 * // Relativistic mode (compare student vs teacher)
 * const result2 = await judge.evaluate(
 *   { question: 'Explain quantum computing' },
 *   studentResponse,
 *   teacherResponse
 * );
 *
 * // Reference-free mode (no comparison data)
 * const result3 = await judge.evaluate(
 *   { question: 'Write a poem' },
 *   { poem: 'Roses are red...' }
 * );
 * ```
 */
export class AxJudge<IN extends AxGenIn, OUT extends AxGenOut> {
  private signature: AxSignature<IN, OUT>;
  private options: Omit<AxJudgeOptions, 'randomizeOrder'> & {
    randomizeOrder: boolean;
  };

  constructor(signature: AxSignature<IN, OUT>, options: AxJudgeOptions) {
    this.signature = signature;
    this.options = {
      ...options,
      randomizeOrder: options.randomizeOrder ?? true,
    };
  }

  private buildForwardOptions(): AxJudgeForwardOptions {
    const {
      ai: _ai,
      criteria: _criteria,
      description: _description,
      randomizeOrder: _randomizeOrder,
      ...forwardOptions
    } = this.options;

    return {
      ...forwardOptions,
      maxSteps: 1,
    };
  }

  private buildTaskDescription(): string {
    const baseDescription =
      this.signature.getDescription() ||
      'Complete the task based on the input.';
    const extraDescription = this.options.description?.trim();

    if (!extraDescription) {
      return baseDescription;
    }

    return `${baseDescription}\n\nAdditional Judge Guidance:\n${extraDescription}`;
  }

  /**
   * The main entry point. Automatically routes to the best strategy.
   */
  async evaluate(
    input: IN,
    studentOutput: OUT,
    referenceOutput?: OUT
  ): Promise<AxJudgeResult> {
    // 1. ABSOLUTE: If strict equality is possible and reference exists
    if (referenceOutput && canUseAbsoluteComparison(referenceOutput)) {
      return this.runAbsolute(studentOutput, referenceOutput);
    }

    // 2. RELATIVISTIC: If we have a reference (Teacher Demo), compare them
    if (referenceOutput) {
      return this.runRelativistic(input, studentOutput, referenceOutput);
    }

    // 3. REFERENCE-FREE: Fallback to general quality check
    return this.runReferenceFree(input, studentOutput);
  }

  /**
   * Strategy 1: Absolute Mode (The "Unit Test")
   * Used when we can directly compare against a ground truth.
   */
  private async runAbsolute(
    student: OUT,
    expected: OUT
  ): Promise<AxJudgeResult> {
    const outputFields = this.signature.getOutputFields();
    let matchCount = 0;
    let totalFields = 0;
    const mismatches: string[] = [];

    for (const field of outputFields) {
      const studentVal = (student as Record<string, unknown>)[field.name];
      const expectedVal = (expected as Record<string, unknown>)[field.name];

      if (expectedVal !== undefined) {
        totalFields++;
        if (isEqual(studentVal, expectedVal)) {
          matchCount++;
        } else {
          mismatches.push(
            `${field.name}: expected "${expectedVal}", got "${studentVal}"`
          );
        }
      }
    }

    const score = totalFields > 0 ? matchCount / totalFields : 0;
    const reasoning =
      score === 1
        ? 'All fields match expected values exactly.'
        : `Mismatches found: ${mismatches.join('; ')}`;

    return {
      score,
      reasoning,
      mode: 'absolute',
    };
  }

  /**
   * Strategy 2: Relativistic Mode (The "RARO" Adversarial Check)
   * Compares student output against teacher output.
   * Key insight: Comparative judgment is more reliable than absolute scoring.
   */
  private async runRelativistic(
    input: IN,
    student: OUT,
    teacher: OUT
  ): Promise<AxJudgeResult> {
    const inputFields = this.signature.getInputFields();
    const outputFields = this.signature.getOutputFields();

    // Randomize A/B order to reduce position bias
    const studentIsA = this.options.randomizeOrder ? Math.random() > 0.5 : true;
    const responseA = studentIsA ? student : teacher;
    const responseB = studentIsA ? teacher : student;

    const compareInstruction = `
You are an impartial judge comparing two AI system outputs for the same input.

**Task Description:** ${this.buildTaskDescription()}

**Input Fields:**
${describeFields(inputFields)}

**Output Fields:**
${describeFields(outputFields)}

**Instructions:**
1. Carefully analyze both Response A and Response B
2. Consider accuracy, completeness, helpfulness, and quality
3. Determine which response is better overall
4. Provide clear reasoning for your decision

**Important:** Do not be swayed by response length alone. Focus on quality and correctness.
`.trim();

    const compareGen = new AxGen<
      { task_input: string; system_output_a: string; system_output_b: string },
      { winner: string; reasoning: string }
    >(`
      task_input:string "The original task input",
      system_output_a:string "System Output A",
      system_output_b:string "System Output B"
      ->
      winner:class "A, B, Tie" "Which response is better",
      reasoning:string "Detailed explanation for the decision"
    `);
    compareGen.setInstruction(compareInstruction);

    const result = await compareGen.forward(
      this.options.ai,
      {
        task_input: JSON.stringify(input),
        system_output_a: JSON.stringify(responseA),
        system_output_b: JSON.stringify(responseB),
      },
      this.buildForwardOptions()
    );

    // Map winner back to student/teacher
    let winner: 'student' | 'teacher' | 'tie';
    let score: number;

    const winnerRaw = result.winner.toUpperCase();
    if (winnerRaw === 'A') {
      winner = studentIsA ? 'student' : 'teacher';
    } else if (winnerRaw === 'B') {
      winner = studentIsA ? 'teacher' : 'student';
    } else {
      winner = 'tie';
    }

    // Scoring: Win = 1.0, Tie = 0.5, Loss = 0.0
    if (winner === 'student') {
      score = 1.0;
    } else if (winner === 'tie') {
      score = 0.5;
    } else {
      score = 0.0;
    }

    return {
      score,
      reasoning: result.reasoning,
      mode: 'relativistic',
      winner,
    };
  }

  /**
   * Strategy 3: Reference-Free Mode (The "Vibe Check")
   * Evaluates against general heuristic criteria using discrete quality tiers.
   *
   * Per RARO paper: LLMs are more reliable at classification than numeric scoring.
   * Using discrete tiers reduces variance and degeneracy issues.
   */
  private async runReferenceFree(
    input: IN,
    output: OUT
  ): Promise<AxJudgeResult> {
    const inputFields = this.signature.getInputFields();
    const outputFields = this.signature.getOutputFields();

    const criteria =
      this.options.criteria ||
      `
Based on the task description and output requirements:
- Accuracy: Is the response factually correct and complete?
- Relevance: Does it address the input appropriately?
- Quality: Is it well-structured and clear?
- Safety: Is it appropriate and non-harmful?
`.trim();

    const qualityInstruction = `
You are evaluating the quality of an AI system output.

**Task Description:** ${this.buildTaskDescription()}

**Input Fields:**
${describeFields(inputFields)}

**Output Fields:**
${describeFields(outputFields)}

**Evaluation Criteria:**
${criteria}

**Quality Tiers:**
- excellent: Exceptional response that fully addresses all criteria with high quality
- good: Solid response that addresses most criteria well
- acceptable: Adequate response that meets minimum requirements
- poor: Response contains fabricated, incorrect, or contradictory information
- unacceptable: Response is wrong, harmful, or completely off-topic

First explain your reasoning, then classify the response into one of the quality tiers.
`.trim();

    const qualityGen = new AxGen<
      { task_input: string; system_output: string },
      { reasoning: string; quality: string }
    >(`
      task_input:string "The original task input",
      system_output:string "The AI system output to evaluate"
      ->
      reasoning:string "Detailed explanation for the quality assessment",
      quality:class "excellent, good, acceptable, poor, unacceptable" "Quality tier"
    `);
    qualityGen.setInstruction(qualityInstruction);

    const result = await qualityGen.forward(
      this.options.ai,
      {
        task_input: JSON.stringify(input),
        system_output: JSON.stringify(output),
      },
      this.buildForwardOptions()
    );

    // Map discrete quality tiers to scores
    const qualityToScore: Record<string, number> = {
      excellent: 1.0,
      good: 0.8,
      acceptable: 0.5,
      poor: 0.2,
      unacceptable: 0.0,
    };

    const qualityTier = result.quality.toLowerCase();
    const score = qualityToScore[qualityTier] ?? 0.5;

    return {
      score,
      reasoning: result.reasoning,
      mode: 'reference-free',
      qualityTier,
    };
  }

  /**
   * Convert this judge to a metric function for use with optimizers.
   * Uses relativistic mode when teacher output is available as expected.
   */
  toMetricFn(): AxMetricFn {
    return async (args: AxMetricFnArgs): Promise<number> => {
      const { example, prediction } = args;

      // Build input from example
      const input = {} as IN;
      for (const field of this.signature.getInputFields()) {
        if (field.name in example) {
          (input as AxGenIn)[field.name] = example[field.name];
        }
      }

      // Build expected from example (output fields) - this is the "teacher" output
      const expected = {} as OUT;
      let hasExpected = false;
      for (const field of this.signature.getOutputFields()) {
        if (field.name in example) {
          (expected as AxGenOut)[field.name] = example[field.name];
          hasExpected = true;
        }
      }

      // Build actual from prediction (student output)
      const actual = prediction as OUT;

      // Use polymorphic evaluate - will pick the right mode
      const result = await this.evaluate(
        input,
        actual,
        hasExpected ? expected : undefined
      );
      return result.score;
    };
  }

  /**
   * Get the signature being evaluated.
   */
  getSignature(): AxSignature<IN, OUT> {
    return this.signature;
  }
}

/**
 * Factory function to create an AxJudge instance.
 */
export function judge<IN extends AxGenIn, OUT extends AxGenOut>(
  signature: AxSignature<IN, OUT>,
  options: AxJudgeOptions
): AxJudge<IN, OUT> {
  return new AxJudge(signature, options);
}
