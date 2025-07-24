import type { AxOptimizerArgs } from '../optimizer.js';
import type {
  PythonOptimizationParameter,
  PythonOptimizationRequest,
} from './pythonOptimizerClient.js';

/**
 * Configuration parameter for MiPro optimization
 */
export interface MiProConfig {
  instruction: string;
  bootstrappedDemos: number;
  labeledExamples: number;
  temperature?: number;
  // Add other parameters that can be optimized
  [key: string]: string | number | boolean | undefined;
}

/**
 * Maps MiPro optimizer options to Python optimizer parameters
 */
export function mapMiProToPythonParameters(
  args: AxOptimizerArgs
): PythonOptimizationParameter[] {
  const parameters: PythonOptimizationParameter[] = [];

  // Bootstrapped demos parameter
  parameters.push({
    name: 'bootstrappedDemos',
    type: 'int',
    low: 0,
    high: args.maxBootstrappedDemos ?? 5,
    step: 1,
  });

  // Labeled examples parameter
  parameters.push({
    name: 'labeledExamples',
    type: 'int',
    low: 0,
    high: args.maxLabeledDemos ?? 8,
    step: 1,
  });

  // Temperature parameter (always included for optimization)
  parameters.push({
    name: 'temperature',
    type: 'float',
    low: 0.1,
    high: 2.0,
    step: 0.1,
  });

  // Add instruction as a categorical parameter for different instruction types
  // This is a simplified approach - in practice, instructions would be generated dynamically
  const instructionTemplates = [
    'instruction_basic',
    'instruction_detailed',
    'instruction_step_by_step',
    'instruction_constraint_focused',
    'instruction_example_heavy',
  ];

  parameters.push({
    name: 'instructionTemplate',
    type: 'categorical',
    choices: instructionTemplates,
  });

  // Add sampling-related parameters if using self-consistency
  if ((args.sampleCount ?? 1) > 1) {
    parameters.push({
      name: 'sampleCount',
      type: 'int',
      low: 1,
      high: Math.max(args.sampleCount ?? 3, 5),
      step: 1,
    });
  }

  return parameters;
}

/**
 * Creates a Python optimization request from MiPro options
 */
export function createPythonOptimizationRequest(
  studyName: string,
  args: AxOptimizerArgs,
  objective: { name: string; direction: 'minimize' | 'maximize' } = {
    name: 'score',
    direction: 'maximize',
  }
): PythonOptimizationRequest {
  const parameters = mapMiProToPythonParameters(args);

  // Map sampler names
  let sampler = 'TPESampler';
  if (args.bayesianOptimization) {
    switch (args.acquisitionFunction) {
      case 'expected_improvement':
        sampler = 'TPESampler';
        break;
      case 'upper_confidence_bound':
        sampler = 'CmaEsSampler';
        break;
      case 'probability_improvement':
        sampler = 'RandomSampler';
        break;
      default:
        sampler = 'TPESampler';
    }
  }

  // Map pruner - use MedianPruner if minibatch is enabled
  const pruner = args.minibatch ? 'MedianPruner' : undefined;

  return {
    study_name: studyName,
    parameters,
    objective,
    n_trials: args.numTrials ?? 30,
    timeout: undefined, // Will be handled at the job level
    sampler,
    pruner,
    metadata: {
      originalArgs: args,
      miproVersion: 'v2-python',
    },
  };
}

/**
 * Converts Python parameter suggestion to MiPro config
 */
export function pythonParamsToMiProConfig(
  params: Record<string, string | number | boolean>,
  baseInstruction?: string
): MiProConfig {
  const config: MiProConfig = {
    instruction: baseInstruction ?? 'Please complete the following task.',
    bootstrappedDemos: (params.bootstrappedDemos as number) ?? 3,
    labeledExamples: (params.labeledExamples as number) ?? 4,
  };

  // Map temperature if present
  if (params.temperature !== undefined) {
    config.temperature = params.temperature as number;
  }

  // Map instruction template to actual instruction
  if (params.instructionTemplate) {
    config.instruction = generateInstructionFromTemplate(
      params.instructionTemplate as string,
      baseInstruction
    );
  }

  // Map sample count if present
  if (params.sampleCount !== undefined) {
    config.sampleCount = params.sampleCount as number;
  }

  return config;
}

/**
 * Generates instruction text from template type
 */
function generateInstructionFromTemplate(
  template: string,
  baseInstruction?: string
): string {
  const base = baseInstruction ?? 'Please complete the following task';

  switch (template) {
    case 'instruction_basic':
      return `${base}.`;

    case 'instruction_detailed':
      return `${base}. Be very specific and detailed in your response.`;

    case 'instruction_step_by_step':
      return `${base}. Think through this step-by-step and show your reasoning.`;

    case 'instruction_constraint_focused':
      return `${base}. Follow all constraints carefully and ensure accuracy.`;

    case 'instruction_example_heavy':
      return `${base}. Use the provided examples as a guide for the expected format and style.`;

    default:
      return `${base}.`;
  }
}

/**
 * Extracts the base instruction from a program for optimization
 */
export function extractBaseInstruction(program: {
  signature?: { instruction?: string };
}): string {
  return program.signature?.instruction ?? 'Please complete the following task';
}

/**
 * Validates that Python parameters are compatible with MiPro configuration
 */
export function validatePythonParameters(
  params: Record<string, string | number | boolean>,
  args: AxOptimizerArgs
): boolean {
  // Check bootstrapped demos is within bounds
  const bootstrappedDemos = params.bootstrappedDemos as number;
  if (
    bootstrappedDemos < 0 ||
    bootstrappedDemos > (args.maxBootstrappedDemos ?? 5)
  ) {
    return false;
  }

  // Check labeled examples is within bounds
  const labeledExamples = params.labeledExamples as number;
  if (labeledExamples < 0 || labeledExamples > (args.maxLabeledDemos ?? 8)) {
    return false;
  }

  // Check temperature if present
  if (params.temperature !== undefined) {
    const temperature = params.temperature as number;
    if (temperature < 0.1 || temperature > 2.0) {
      return false;
    }
  }

  return true;
}

/**
 * Gets parameter bounds for the Python optimizer based on MiPro options
 */
export function getMiProParameterBounds(args: AxOptimizerArgs) {
  return {
    bootstrappedDemos: { min: 0, max: args.maxBootstrappedDemos ?? 5 },
    labeledExamples: { min: 0, max: args.maxLabeledDemos ?? 8 },
    temperature: { min: 0.1, max: 2.0 },
    sampleCount: { min: 1, max: Math.max(args.sampleCount ?? 3, 5) },
  };
}
