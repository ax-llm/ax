/**
 * AxSynth - Synthetic data generator for bootstrapping optimization datasets.
 *
 * Generates diverse input examples and uses a teacher model to produce
 * high-quality labeled outputs. Solves the "cold start" problem when
 * users have no training data.
 */

import type { AxAIService } from '../ai/types.js';
import { AxGen } from './generate.js';
import type { AxField, AxSignature } from './sig.js';
import type { AxGenIn, AxGenOut } from './types.js';

/**
 * Configuration for synthetic data generation.
 */
export interface AxSynthOptions {
  /** Teacher AI to use for labeling generated inputs */
  teacher: AxAIService;

  /**
   * Diversity strategy for input generation.
   * - 'semantic': Use embeddings to maximize semantic diversity
   * - 'lexical': Use token-based diversity
   * - 'none': No diversity filtering (default)
   */
  diversity?: 'semantic' | 'lexical' | 'none';

  /** Domain context for generating relevant examples */
  domain?: string;

  /**
   * Edge case hints for generating challenging examples.
   * Examples: "empty inputs", "very long queries", "special characters"
   */
  edgeCases?: string[];

  /** Temperature for input generation (default: 0.8) */
  temperature?: number;

  /** Model to use for generation (optional, uses teacher's default) */
  model?: string;
}

/**
 * A single synthesized example with input and expected output.
 */
export interface AxSynthExample {
  /** Generated input values */
  input: Record<string, unknown>;
  /** Expected output values from teacher model */
  expected: Record<string, unknown>;
  /** Category of the example (normal, edge case, etc.) */
  category?: string;
}

/**
 * Result from a synthesis run.
 */
export interface AxSynthResult {
  /** Generated examples */
  examples: AxSynthExample[];
  /** Statistics about the generation */
  stats: {
    requested: number;
    generated: number;
    labelingSuccessRate: number;
    durationMs: number;
  };
}

/**
 * Build a prompt describing the input fields for synthesis.
 */
function describeInputFields(fields: readonly AxField[]): string {
  return fields
    .map((f) => {
      const typeName = f.type?.name ?? 'string';
      const isArray = f.type?.isArray ? '[]' : '';
      const isOptional = f.isOptional ? ' (optional)' : '';
      const desc = f.description ? `: ${f.description}` : '';
      return `- ${f.name}: ${typeName}${isArray}${isOptional}${desc}`;
    })
    .join('\n');
}

/**
 * Build a prompt describing the output fields for labeling context.
 */
function describeOutputFields(fields: readonly AxField[]): string {
  return fields
    .map((f) => {
      const typeName = f.type?.name ?? 'string';
      const isArray = f.type?.isArray ? '[]' : '';
      const options = f.type?.options
        ? ` (options: ${f.type.options.join(', ')})`
        : '';
      const desc = f.description ? `: ${f.description}` : '';
      return `- ${f.name}: ${typeName}${isArray}${options}${desc}`;
    })
    .join('\n');
}

/**
 * AxSynth generates synthetic training data.
 *
 * @example
 * ```typescript
 * const synth = new AxSynth(signature, {
 *   teacher: ai('openai', { model: 'gpt-4o' }),
 *   domain: 'customer support',
 *   edgeCases: ['angry customers', 'vague requests'],
 * });
 *
 * const { examples } = await synth.generate(100);
 * ```
 */
export class AxSynth<IN extends AxGenIn, OUT extends AxGenOut> {
  private signature: AxSignature<IN, OUT>;
  private options: Required<
    Pick<AxSynthOptions, 'teacher' | 'diversity' | 'temperature'>
  > &
    Pick<AxSynthOptions, 'domain' | 'edgeCases' | 'model'>;

  constructor(signature: AxSignature<IN, OUT>, options: AxSynthOptions) {
    this.signature = signature;
    this.options = {
      teacher: options.teacher,
      diversity: options.diversity ?? 'none',
      temperature: options.temperature ?? 0.8,
      domain: options.domain,
      edgeCases: options.edgeCases,
      model: options.model,
    };
  }

  /**
   * Generate synthetic examples.
   */
  async generate(
    count: number,
    options?: { batchSize?: number }
  ): Promise<AxSynthResult> {
    const startTime = Date.now();
    const batchSize = options?.batchSize ?? Math.min(count, 10);
    const examples: AxSynthExample[] = [];
    let labelingSuccesses = 0;
    let totalAttempts = 0;

    // Generate in batches
    for (let offset = 0; offset < count; offset += batchSize) {
      const currentBatchSize = Math.min(batchSize, count - offset);
      const inputs = await this.generateInputs(currentBatchSize);

      // Label each input with the teacher
      for (const input of inputs) {
        totalAttempts++;
        try {
          const expected = await this.labelInput(input);
          examples.push({
            input,
            expected,
            category: 'normal',
          });
          labelingSuccesses++;
        } catch (err) {
          console.warn('AxSynth: Failed to label input:', err);
        }
      }
    }

    // Generate edge cases if requested
    if (this.options.edgeCases && this.options.edgeCases.length > 0) {
      const edgeCaseInputs = await this.generateEdgeCaseInputs(
        Math.ceil(count * 0.2)
      );

      for (const input of edgeCaseInputs) {
        totalAttempts++;
        try {
          const expected = await this.labelInput(input);
          examples.push({
            input,
            expected,
            category: 'edge_case',
          });
          labelingSuccesses++;
        } catch (err) {
          console.warn('AxSynth: Failed to label edge case input:', err);
        }
      }
    }

    return {
      examples,
      stats: {
        requested: count,
        generated: examples.length,
        labelingSuccessRate:
          totalAttempts > 0 ? labelingSuccesses / totalAttempts : 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Generate diverse input examples using a synthesis prompt.
   */
  private async generateInputs(
    count: number
  ): Promise<Record<string, unknown>[]> {
    const inputFields = this.signature.getInputFields();
    const outputFields = this.signature.getOutputFields();
    const description = this.signature.getDescription();

    // Build the synthesis instruction
    const synthInstruction = `
You are generating realistic input data for an AI system.

${description ? `Task description: ${description}` : ''}
${this.options.domain ? `Domain: ${this.options.domain}` : ''}

The system expects these INPUT fields:
${describeInputFields(inputFields)}

The system produces these OUTPUT fields:
${describeOutputFields(outputFields)}

Generate ${count} diverse, realistic input examples as a JSON array.
Each example should be an object with the input fields defined above.
Make the examples varied and realistic for the domain.

Output ONLY the JSON array, no explanation.
`.trim();

    const synthGen = new AxGen<
      { count: number },
      { examples: Record<string, unknown>[] }
    >('count:number -> examples:json');
    synthGen.setInstruction(synthInstruction);

    try {
      const result = await synthGen.forward(
        this.options.teacher,
        { count },
        {
          model: this.options.model,
        }
      );

      if (Array.isArray(result.examples)) {
        return result.examples.slice(0, count);
      }
      return [];
    } catch (err) {
      console.warn('AxSynth: Input generation failed:', err);
      return [];
    }
  }

  /**
   * Generate edge case inputs based on hints.
   */
  private async generateEdgeCaseInputs(
    count: number
  ): Promise<Record<string, unknown>[]> {
    const inputFields = this.signature.getInputFields();
    const edgeCases = this.options.edgeCases ?? [];

    const edgeCaseInstruction = `
You are generating challenging edge case input data to test an AI system's robustness.

The system expects these INPUT fields:
${describeInputFields(inputFields)}

Generate ${count} edge case examples as a JSON array.
Focus on these types of edge cases:
${edgeCases.map((ec) => `- ${ec}`).join('\n')}

Output ONLY the JSON array, no explanation.
`.trim();

    const synthGen = new AxGen<
      { count: number },
      { examples: Record<string, unknown>[] }
    >('count:number -> examples:json');
    synthGen.setInstruction(edgeCaseInstruction);

    try {
      const result = await synthGen.forward(
        this.options.teacher,
        { count },
        {
          model: this.options.model,
        }
      );

      if (Array.isArray(result.examples)) {
        return result.examples.slice(0, count);
      }
      return [];
    } catch (err) {
      console.warn('AxSynth: Edge case generation failed:', err);
      return [];
    }
  }

  /**
   * Label an input using the teacher model.
   */
  private async labelInput(
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const teacherGen = new AxGen(this.signature);

    const result = await teacherGen.forward(this.options.teacher, input as IN, {
      model: this.options.model,
    });

    return result as Record<string, unknown>;
  }

  /**
   * Get the signature being used.
   */
  getSignature(): AxSignature<IN, OUT> {
    return this.signature;
  }

  /**
   * Get the teacher AI service.
   */
  getTeacher(): AxAIService {
    return this.options.teacher;
  }
}

/**
 * Factory function to create an AxSynth instance.
 */
export function synth<IN extends AxGenIn, OUT extends AxGenOut>(
  signature: AxSignature<IN, OUT>,
  options: AxSynthOptions
): AxSynth<IN, OUT> {
  return new AxSynth(signature, options);
}
