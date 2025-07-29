import { ColorLog } from '../util/log.js';
import type { AxFlowState } from './types.js';

/**
 * Data types for different AxFlow logging events
 */
export interface AxFlowLoggerData {
  name: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface AxFlowStartData extends AxFlowLoggerData {
  name: 'FlowStart';
  inputFields: string[];
  totalSteps: number;
  parallelGroups: number;
  maxParallelism: number;
  autoParallelEnabled: boolean;
}

export interface AxFlowStepStartData extends AxFlowLoggerData {
  name: 'StepStart';
  stepIndex: number;
  stepType:
    | 'execute'
    | 'map'
    | 'merge'
    | 'parallel-map'
    | 'parallel'
    | 'derive'
    | 'branch'
    | 'feedback'
    | 'while'
    | 'other';
  nodeName?: string;
  dependencies: string[];
  produces: string[];
  state: AxFlowState;
}

export interface AxFlowStepCompleteData extends AxFlowLoggerData {
  name: 'StepComplete';
  stepIndex: number;
  stepType:
    | 'execute'
    | 'map'
    | 'merge'
    | 'parallel-map'
    | 'parallel'
    | 'derive'
    | 'branch'
    | 'feedback'
    | 'while'
    | 'other';
  nodeName?: string;
  executionTime: number;
  state: AxFlowState;
  newFields?: string[];
  result?: any;
}

export interface AxFlowParallelGroupStartData extends AxFlowLoggerData {
  name: 'ParallelGroupStart';
  groupLevel: number;
  stepsCount: number;
  stepTypes: string[];
}

export interface AxFlowParallelGroupCompleteData extends AxFlowLoggerData {
  name: 'ParallelGroupComplete';
  groupLevel: number;
  stepsCount: number;
  executionTime: number;
}

export interface AxFlowBranchEvaluationData extends AxFlowLoggerData {
  name: 'BranchEvaluation';
  branchValue: unknown;
  hasMatchingBranch: boolean;
  branchStepsCount: number;
}

export interface AxFlowCompleteData extends AxFlowLoggerData {
  name: 'FlowComplete';
  totalExecutionTime: number;
  finalState: AxFlowState;
  outputFields: string[];
  stepsExecuted: number;
}

export interface AxFlowErrorData extends AxFlowLoggerData {
  name: 'FlowError';
  error: string;
  stepIndex?: number;
  stepType?: string;
  nodeName?: string;
  state?: AxFlowState;
}

export type AxFlowLogData =
  | AxFlowStartData
  | AxFlowStepStartData
  | AxFlowStepCompleteData
  | AxFlowParallelGroupStartData
  | AxFlowParallelGroupCompleteData
  | AxFlowBranchEvaluationData
  | AxFlowCompleteData
  | AxFlowErrorData;

/**
 * Function type for AxFlow logging
 */
export type AxFlowLoggerFunction = (data: AxFlowLogData) => void;

// Default output function that writes to stdout
const defaultOutput = (message: string): void => {
  console.log(message);
};

/**
 * Formats state object for display, truncating large values
 */
const formatState = (state: AxFlowState, hideContent = false): string => {
  if (hideContent) return '[State hidden]';

  const formatted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'string' && value.length > 100) {
      formatted[key] = `${value.substring(0, 100)}...`;
    } else if (Array.isArray(value) && value.length > 3) {
      formatted[key] = [...value.slice(0, 3), `... (${value.length - 3} more)`];
    } else if (typeof value === 'object' && value !== null) {
      const objStr = JSON.stringify(value);
      if (objStr.length > 200) {
        formatted[key] = `${objStr.substring(0, 200)}...`;
      } else {
        formatted[key] = value;
      }
    } else {
      formatted[key] = value;
    }
  }
  return JSON.stringify(formatted, null, 2);
};

/**
 * Formats execution time for display
 */
const formatTime = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
};

/**
 * Factory function to create a colorized AxFlow logger
 */
export const axCreateFlowColorLogger = (
  output: (message: string) => void = defaultOutput
): AxFlowLoggerFunction => {
  const cl = new ColorLog();
  const divider = cl.gray(`${'━'.repeat(80)}\n`);
  const smallDivider = cl.gray(`${'─'.repeat(40)}\n`);

  return (data: AxFlowLogData) => {
    let formattedMessage = '';

    switch (data.name) {
      case 'FlowStart':
        formattedMessage = `\n${cl.blueBright('🔄 [ AXFLOW START ]')}\n${divider}`;
        formattedMessage += `${cl.white('Input Fields:')} ${cl.cyan(data.inputFields.join(', '))}\n`;
        formattedMessage += `${cl.white('Total Steps:')} ${cl.yellow(data.totalSteps.toString())}\n`;
        formattedMessage += `${cl.white('Parallel Groups:')} ${cl.yellow(data.parallelGroups.toString())}\n`;
        formattedMessage += `${cl.white('Max Parallelism:')} ${cl.yellow(data.maxParallelism.toString())}\n`;
        formattedMessage += `${cl.white('Auto-Parallel:')} ${data.autoParallelEnabled ? cl.green('enabled') : cl.red('disabled')}\n`;
        formattedMessage += divider;
        break;

      case 'StepStart': {
        const stepIcon =
          data.stepType === 'execute'
            ? '⚡'
            : data.stepType === 'map'
              ? '🔄'
              : data.stepType === 'merge'
                ? '🔀'
                : data.stepType === 'parallel'
                  ? '⚖️'
                  : '📋';
        formattedMessage = `${cl.greenBright(`${stepIcon} [ STEP ${data.stepIndex} START ]`)} ${cl.white(`(${data.stepType})`)}`;
        if (data.nodeName) {
          formattedMessage += ` ${cl.cyanBright(`Node: ${data.nodeName}`)}`;
        }
        formattedMessage += '\n';
        if (data.dependencies.length > 0) {
          formattedMessage += `${cl.white('Dependencies:')} ${cl.gray(data.dependencies.join(', '))}\n`;
        }
        if (data.produces.length > 0) {
          formattedMessage += `${cl.white('Produces:')} ${cl.cyan(data.produces.join(', '))}\n`;
        }
        formattedMessage += `${cl.white('State:')} ${cl.gray(formatState(data.state, true))}\n`;
        formattedMessage += smallDivider;
        break;
      }

      case 'StepComplete': {
        const completeIcon =
          data.stepType === 'execute'
            ? '✅'
            : data.stepType === 'map'
              ? '✅'
              : data.stepType === 'merge'
                ? '✅'
                : data.stepType === 'parallel'
                  ? '✅'
                  : '✅';
        formattedMessage = `${cl.greenBright(`${completeIcon} [ STEP ${data.stepIndex} COMPLETE ]`)} ${cl.white(`(${data.stepType})`)}`;
        if (data.nodeName) {
          formattedMessage += ` ${cl.cyanBright(`Node: ${data.nodeName}`)}`;
        }
        formattedMessage += ` ${cl.magenta(`in ${formatTime(data.executionTime)}`)}\n`;
        if (data.newFields && data.newFields.length > 0) {
          formattedMessage += `${cl.white('New Fields:')} ${cl.green(data.newFields.join(', '))}\n`;
        }
        if (data.result && data.nodeName) {
          formattedMessage += `${cl.white('Result:')} ${cl.yellow(JSON.stringify(data.result, null, 2))}\n`;
        }
        formattedMessage += smallDivider;
        break;
      }

      case 'ParallelGroupStart':
        formattedMessage = `${cl.blueBright('⚖️ [ PARALLEL GROUP START ]')} ${cl.white(`Level ${data.groupLevel}`)}\n`;
        formattedMessage += `${cl.white('Steps:')} ${cl.yellow(data.stepsCount.toString())} ${cl.gray(`(${data.stepTypes.join(', ')})`)}\n`;
        formattedMessage += smallDivider;
        break;

      case 'ParallelGroupComplete':
        formattedMessage = `${cl.blueBright('✅ [ PARALLEL GROUP COMPLETE ]')} ${cl.white(`Level ${data.groupLevel}`)}`;
        formattedMessage += ` ${cl.magenta(`in ${formatTime(data.executionTime)}`)}\n`;
        formattedMessage += `${cl.white('Steps Executed:')} ${cl.yellow(data.stepsCount.toString())}\n`;
        formattedMessage += smallDivider;
        break;

      case 'BranchEvaluation':
        formattedMessage = `${cl.yellow('🔀 [ BRANCH EVALUATION ]')}\n`;
        formattedMessage += `${cl.white('Branch Value:')} ${cl.cyan(JSON.stringify(data.branchValue))}\n`;
        formattedMessage += `${cl.white('Has Matching Branch:')} ${data.hasMatchingBranch ? cl.green('yes') : cl.red('no')}\n`;
        if (data.hasMatchingBranch) {
          formattedMessage += `${cl.white('Branch Steps:')} ${cl.yellow(data.branchStepsCount.toString())}\n`;
        }
        formattedMessage += smallDivider;
        break;

      case 'FlowComplete':
        formattedMessage = `\n${cl.greenBright('✅ [ AXFLOW COMPLETE ]')}\n${divider}`;
        formattedMessage += `${cl.white('Total Time:')} ${cl.magenta(formatTime(data.totalExecutionTime))}\n`;
        formattedMessage += `${cl.white('Steps Executed:')} ${cl.yellow(data.stepsExecuted.toString())}\n`;
        formattedMessage += `${cl.white('Output Fields:')} ${cl.green(data.outputFields.join(', '))}\n`;
        formattedMessage += `${cl.white('Final State:')} ${cl.gray(formatState(data.finalState, true))}\n`;
        formattedMessage += divider;
        break;

      case 'FlowError':
        formattedMessage = `\n${cl.redBright('❌ [ AXFLOW ERROR ]')}\n${divider}`;
        if (data.stepIndex !== undefined) {
          formattedMessage += `${cl.white('Step:')} ${cl.yellow(data.stepIndex.toString())}`;
          if (data.stepType)
            formattedMessage += ` ${cl.gray(`(${data.stepType})`)}`;
          if (data.nodeName)
            formattedMessage += ` ${cl.cyan(`Node: ${data.nodeName}`)}`;
          formattedMessage += '\n';
        }
        formattedMessage += `${cl.white('Error:')} ${cl.red(data.error)}\n`;
        if (data.state) {
          formattedMessage += `${cl.white('State:')} ${cl.gray(formatState(data.state, true))}\n`;
        }
        formattedMessage += divider;
        break;

      default:
        formattedMessage = cl.gray(JSON.stringify(data, null, 2));
    }

    output(formattedMessage);
  };
};

/**
 * Factory function to create a text-only AxFlow logger (no colors)
 */
export const axCreateFlowTextLogger = (
  output: (message: string) => void = defaultOutput
): AxFlowLoggerFunction => {
  const divider = '='.repeat(80);
  const smallDivider = '-'.repeat(40);

  return (data: AxFlowLogData) => {
    let formattedMessage = '';

    switch (data.name) {
      case 'FlowStart':
        formattedMessage = `\n[ AXFLOW START ]\n${divider}\n`;
        formattedMessage += `Input Fields: ${data.inputFields.join(', ')}\n`;
        formattedMessage += `Total Steps: ${data.totalSteps}\n`;
        formattedMessage += `Parallel Groups: ${data.parallelGroups}\n`;
        formattedMessage += `Max Parallelism: ${data.maxParallelism}\n`;
        formattedMessage += `Auto-Parallel: ${data.autoParallelEnabled ? 'enabled' : 'disabled'}\n`;
        formattedMessage += `${divider}\n`;
        break;

      case 'StepStart':
        formattedMessage = `[ STEP ${data.stepIndex} START ] (${data.stepType})`;
        if (data.nodeName) {
          formattedMessage += ` Node: ${data.nodeName}`;
        }
        formattedMessage += '\n';
        if (data.dependencies.length > 0) {
          formattedMessage += `Dependencies: ${data.dependencies.join(', ')}\n`;
        }
        if (data.produces.length > 0) {
          formattedMessage += `Produces: ${data.produces.join(', ')}\n`;
        }
        formattedMessage += `State: ${formatState(data.state, true)}\n`;
        formattedMessage += `${smallDivider}\n`;
        break;

      case 'StepComplete':
        formattedMessage = `[ STEP ${data.stepIndex} COMPLETE ] (${data.stepType})`;
        if (data.nodeName) {
          formattedMessage += ` Node: ${data.nodeName}`;
        }
        formattedMessage += ` in ${formatTime(data.executionTime)}\n`;
        if (data.newFields && data.newFields.length > 0) {
          formattedMessage += `New Fields: ${data.newFields.join(', ')}\n`;
        }
        if (data.result && data.nodeName) {
          formattedMessage += `Result: ${JSON.stringify(data.result, null, 2)}\n`;
        }
        formattedMessage += `${smallDivider}\n`;
        break;

      case 'ParallelGroupStart':
        formattedMessage = `[ PARALLEL GROUP START ] Level ${data.groupLevel}\n`;
        formattedMessage += `Steps: ${data.stepsCount} (${data.stepTypes.join(', ')})\n`;
        formattedMessage += `${smallDivider}\n`;
        break;

      case 'ParallelGroupComplete':
        formattedMessage = `[ PARALLEL GROUP COMPLETE ] Level ${data.groupLevel} in ${formatTime(data.executionTime)}\n`;
        formattedMessage += `Steps Executed: ${data.stepsCount}\n`;
        formattedMessage += `${smallDivider}\n`;
        break;

      case 'BranchEvaluation':
        formattedMessage = `[ BRANCH EVALUATION ]\n`;
        formattedMessage += `Branch Value: ${JSON.stringify(data.branchValue)}\n`;
        formattedMessage += `Has Matching Branch: ${data.hasMatchingBranch ? 'yes' : 'no'}\n`;
        if (data.hasMatchingBranch) {
          formattedMessage += `Branch Steps: ${data.branchStepsCount}\n`;
        }
        formattedMessage += `${smallDivider}\n`;
        break;

      case 'FlowComplete':
        formattedMessage = `\n[ AXFLOW COMPLETE ]\n${divider}\n`;
        formattedMessage += `Total Time: ${formatTime(data.totalExecutionTime)}\n`;
        formattedMessage += `Steps Executed: ${data.stepsExecuted}\n`;
        formattedMessage += `Output Fields: ${data.outputFields.join(', ')}\n`;
        formattedMessage += `Final State: ${formatState(data.finalState, true)}\n`;
        formattedMessage += `${divider}\n`;
        break;

      case 'FlowError':
        formattedMessage = `\n[ AXFLOW ERROR ]\n${divider}\n`;
        if (data.stepIndex !== undefined) {
          formattedMessage += `Step: ${data.stepIndex}`;
          if (data.stepType) formattedMessage += ` (${data.stepType})`;
          if (data.nodeName) formattedMessage += ` Node: ${data.nodeName}`;
          formattedMessage += '\n';
        }
        formattedMessage += `Error: ${data.error}\n`;
        if (data.state) {
          formattedMessage += `State: ${formatState(data.state, true)}\n`;
        }
        formattedMessage += `${divider}\n`;
        break;

      default:
        formattedMessage = JSON.stringify(data, null, 2);
    }

    output(formattedMessage);
  };
};

/**
 * Default AxFlow logger with colors
 */
export const axDefaultFlowLogger: AxFlowLoggerFunction =
  axCreateFlowColorLogger();

/**
 * Helper function to create a timing wrapper around the logger
 */
export const createTimingLogger = (logger: AxFlowLoggerFunction) => {
  const timingData = new Map<string, number>();

  return {
    logger,
    startTiming: (key: string) => {
      timingData.set(key, Date.now());
    },
    endTiming: (key: string): number => {
      const start = timingData.get(key);
      if (!start) return 0;
      const duration = Date.now() - start;
      timingData.delete(key);
      return duration;
    },
    getCurrentTime: () => Date.now(),
  };
};
