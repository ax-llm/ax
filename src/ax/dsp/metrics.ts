import type { Counter, Gauge, Histogram, Meter } from '@opentelemetry/api';

import { axGlobals } from './globals.js';

// Metrics configuration interface
export interface AxMetricsConfig {
  enabled: boolean;
  enabledCategories: (
    | 'generation'
    | 'streaming'
    | 'functions'
    | 'errors'
    | 'performance'
  )[];
  maxLabelLength: number;
  samplingRate: number;
}

// Default metrics configuration
export const axDefaultMetricsConfig: AxMetricsConfig = {
  enabled: true,
  enabledCategories: [
    'generation',
    'streaming',
    'functions',
    'errors',
    'performance',
  ],
  maxLabelLength: 100,
  samplingRate: 1.0,
};

// Standardized error categories for consistent error classification
export type AxErrorCategory =
  | 'validation_error'
  | 'assertion_error'
  | 'timeout_error'
  | 'abort_error'
  | 'network_error'
  | 'auth_error'
  | 'rate_limit_error'
  | 'function_error'
  | 'parsing_error'
  | 'unknown_error';

export interface AxGenMetricsInstruments {
  // Generation flow metrics
  generationLatencyHistogram?: Histogram;
  generationRequestsCounter?: Counter;
  generationErrorsCounter?: Counter;

  // Multi-step flow metrics
  multiStepGenerationsCounter?: Counter;
  stepsPerGenerationHistogram?: Histogram;
  maxStepsReachedCounter?: Counter;

  // Error correction metrics
  validationErrorsCounter?: Counter;
  assertionErrorsCounter?: Counter;
  errorCorrectionAttemptsHistogram?: Histogram;
  errorCorrectionSuccessCounter?: Counter;
  errorCorrectionFailureCounter?: Counter;
  maxRetriesReachedCounter?: Counter;

  // Function calling metrics
  functionsEnabledGenerationsCounter?: Counter;
  functionCallStepsCounter?: Counter;
  functionsExecutedPerGenerationHistogram?: Histogram;
  functionErrorCorrectionCounter?: Counter;

  // Field processing metrics
  fieldProcessorsExecutedCounter?: Counter;
  streamingFieldProcessorsExecutedCounter?: Counter;

  // Streaming specific metrics
  streamingGenerationsCounter?: Counter;
  streamingDeltasEmittedCounter?: Counter;
  streamingFinalizationLatencyHistogram?: Histogram;

  // Memory and samples metrics
  samplesGeneratedHistogram?: Histogram;
  resultPickerUsageCounter?: Counter;
  resultPickerLatencyHistogram?: Histogram;

  // Signature complexity metrics
  inputFieldsGauge?: Gauge;
  outputFieldsGauge?: Gauge;
  examplesUsedGauge?: Gauge;
  demosUsedGauge?: Gauge;

  // Performance metrics
  promptRenderLatencyHistogram?: Histogram;
  extractionLatencyHistogram?: Histogram;
  assertionLatencyHistogram?: Histogram;

  // State management
  stateCreationLatencyHistogram?: Histogram;
  memoryUpdateLatencyHistogram?: Histogram;
}

// Singleton instance for metrics instruments
let globalGenMetricsInstruments: AxGenMetricsInstruments | undefined;

// Function to get or create metrics instruments (singleton pattern)
export const getOrCreateGenMetricsInstruments = (
  meter?: Meter
): AxGenMetricsInstruments | undefined => {
  // Return existing instance if available
  if (globalGenMetricsInstruments) {
    return globalGenMetricsInstruments;
  }

  // Try to use provided meter or fall back to global
  const activeMeter = meter ?? axGlobals.meter;
  if (activeMeter) {
    globalGenMetricsInstruments = createGenMetricsInstruments(activeMeter);
    return globalGenMetricsInstruments;
  }

  return undefined;
};

// Function to reset the singleton (useful for testing)
export const resetGenMetricsInstruments = (): void => {
  globalGenMetricsInstruments = undefined;
};

// Health check for metrics system
export const axCheckMetricsHealth = (): {
  healthy: boolean;
  issues: string[];
} => {
  const issues: string[] = [];

  if (!axGlobals.meter) {
    issues.push('Global meter not initialized');
  }

  if (!globalGenMetricsInstruments && axGlobals.meter) {
    issues.push('Metrics instruments not created despite available meter');
  }

  return {
    healthy: issues.length === 0,
    issues,
  };
};

export const createGenMetricsInstruments = (
  meter: Meter
): AxGenMetricsInstruments => {
  return {
    // Generation flow metrics
    // Note: Histogram buckets should be configured at the exporter level
    // Recommended buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] ms
    generationLatencyHistogram: meter.createHistogram(
      'ax_gen_generation_duration_ms',
      {
        description: 'End-to-end duration of AxGen generation requests',
        unit: 'ms',
      }
    ),

    generationRequestsCounter: meter.createCounter(
      'ax_gen_generation_requests_total',
      {
        description: 'Total number of AxGen generation requests',
      }
    ),

    generationErrorsCounter: meter.createCounter(
      'ax_gen_generation_errors_total',
      {
        description: 'Total number of failed AxGen generations',
      }
    ),

    // Multi-step flow metrics
    multiStepGenerationsCounter: meter.createCounter(
      'ax_gen_multistep_generations_total',
      {
        description: 'Total number of generations that required multiple steps',
      }
    ),

    stepsPerGenerationHistogram: meter.createHistogram(
      'ax_gen_steps_per_generation',
      {
        description: 'Number of steps taken per generation',
      }
    ),

    maxStepsReachedCounter: meter.createCounter(
      'ax_gen_max_steps_reached_total',
      {
        description: 'Total number of generations that hit max steps limit',
      }
    ),

    // Error correction metrics
    validationErrorsCounter: meter.createCounter(
      'ax_gen_validation_errors_total',
      {
        description: 'Total number of validation errors encountered',
      }
    ),

    assertionErrorsCounter: meter.createCounter(
      'ax_gen_assertion_errors_total',
      {
        description: 'Total number of assertion errors encountered',
      }
    ),

    errorCorrectionAttemptsHistogram: meter.createHistogram(
      'ax_gen_error_correction_attempts',
      {
        description: 'Number of error correction attempts per generation',
      }
    ),

    errorCorrectionSuccessCounter: meter.createCounter(
      'ax_gen_error_correction_success_total',
      {
        description: 'Total number of successful error corrections',
      }
    ),

    errorCorrectionFailureCounter: meter.createCounter(
      'ax_gen_error_correction_failure_total',
      {
        description: 'Total number of failed error corrections',
      }
    ),

    maxRetriesReachedCounter: meter.createCounter(
      'ax_gen_max_retries_reached_total',
      {
        description: 'Total number of generations that hit max retries limit',
      }
    ),

    // Function calling metrics
    functionsEnabledGenerationsCounter: meter.createCounter(
      'ax_gen_functions_enabled_generations_total',
      {
        description: 'Total number of generations with functions enabled',
      }
    ),

    functionCallStepsCounter: meter.createCounter(
      'ax_gen_function_call_steps_total',
      {
        description: 'Total number of steps that included function calls',
      }
    ),

    functionsExecutedPerGenerationHistogram: meter.createHistogram(
      'ax_gen_functions_executed_per_generation',
      {
        description: 'Number of unique functions executed per generation',
      }
    ),

    functionErrorCorrectionCounter: meter.createCounter(
      'ax_gen_function_error_correction_total',
      {
        description: 'Total number of function-related error corrections',
      }
    ),

    // Field processing metrics
    fieldProcessorsExecutedCounter: meter.createCounter(
      'ax_gen_field_processors_executed_total',
      {
        description: 'Total number of field processors executed',
      }
    ),

    streamingFieldProcessorsExecutedCounter: meter.createCounter(
      'ax_gen_streaming_field_processors_executed_total',
      {
        description: 'Total number of streaming field processors executed',
      }
    ),

    // Streaming specific metrics
    streamingGenerationsCounter: meter.createCounter(
      'ax_gen_streaming_generations_total',
      {
        description: 'Total number of streaming generations',
      }
    ),

    streamingDeltasEmittedCounter: meter.createCounter(
      'ax_gen_streaming_deltas_emitted_total',
      {
        description: 'Total number of streaming deltas emitted',
      }
    ),

    streamingFinalizationLatencyHistogram: meter.createHistogram(
      'ax_gen_streaming_finalization_duration_ms',
      {
        description: 'Duration of streaming response finalization',
        unit: 'ms',
      }
    ),

    // Memory and samples metrics
    samplesGeneratedHistogram: meter.createHistogram(
      'ax_gen_samples_generated',
      {
        description: 'Number of samples generated per request',
      }
    ),

    resultPickerUsageCounter: meter.createCounter(
      'ax_gen_result_picker_usage_total',
      {
        description: 'Total number of times result picker was used',
      }
    ),

    resultPickerLatencyHistogram: meter.createHistogram(
      'ax_gen_result_picker_duration_ms',
      {
        description: 'Duration of result picker execution',
        unit: 'ms',
      }
    ),

    // Signature complexity metrics
    inputFieldsGauge: meter.createGauge('ax_gen_input_fields', {
      description: 'Number of input fields in signature',
    }),

    outputFieldsGauge: meter.createGauge('ax_gen_output_fields', {
      description: 'Number of output fields in signature',
    }),

    examplesUsedGauge: meter.createGauge('ax_gen_examples_used', {
      description: 'Number of examples used in generation',
    }),

    demosUsedGauge: meter.createGauge('ax_gen_demos_used', {
      description: 'Number of demos used in generation',
    }),

    // Performance metrics
    promptRenderLatencyHistogram: meter.createHistogram(
      'ax_gen_prompt_render_duration_ms',
      {
        description: 'Duration of prompt template rendering',
        unit: 'ms',
      }
    ),

    extractionLatencyHistogram: meter.createHistogram(
      'ax_gen_extraction_duration_ms',
      {
        description: 'Duration of value extraction from responses',
        unit: 'ms',
      }
    ),

    assertionLatencyHistogram: meter.createHistogram(
      'ax_gen_assertion_duration_ms',
      {
        description: 'Duration of assertion checking',
        unit: 'ms',
      }
    ),

    // State management
    stateCreationLatencyHistogram: meter.createHistogram(
      'ax_gen_state_creation_duration_ms',
      {
        description: 'Duration of state creation for multiple samples',
        unit: 'ms',
      }
    ),

    memoryUpdateLatencyHistogram: meter.createHistogram(
      'ax_gen_memory_update_duration_ms',
      {
        description: 'Duration of memory updates during generation',
        unit: 'ms',
      }
    ),
  };
};

// Global metrics configuration
let currentMetricsConfig: AxMetricsConfig = axDefaultMetricsConfig;

// Function to update metrics configuration
export const axUpdateMetricsConfig = (
  config: Readonly<Partial<AxMetricsConfig>>
): void => {
  currentMetricsConfig = { ...currentMetricsConfig, ...config };
};

// Function to get current metrics configuration
export const axGetMetricsConfig = (): AxMetricsConfig => {
  return { ...currentMetricsConfig };
};

// Utility function to sanitize metric labels
const sanitizeLabels = (
  labels: Record<string, unknown>
): Record<string, string> => {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value !== undefined && value !== null) {
      const stringValue = String(value);
      // Limit label length based on configuration
      const maxLength = currentMetricsConfig.maxLabelLength;
      sanitized[key] =
        stringValue.length > maxLength
          ? stringValue.substring(0, maxLength)
          : stringValue;
    }
  }
  return sanitized;
};

// Recording functions for generation flow metrics
export const recordGenerationMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  duration: number,
  success: boolean,
  signatureName?: string,
  aiService?: string,
  model?: string
): void => {
  try {
    const labels = sanitizeLabels({
      success: success.toString(),
      ...(signatureName ? { signature: signatureName } : {}),
      ...(aiService ? { ai_service: aiService } : {}),
      ...(model ? { model } : {}),
    });

    if (instruments.generationLatencyHistogram) {
      instruments.generationLatencyHistogram.record(duration, labels);
    }

    if (instruments.generationRequestsCounter) {
      instruments.generationRequestsCounter.add(1, labels);
    }

    if (!success && instruments.generationErrorsCounter) {
      instruments.generationErrorsCounter.add(1, labels);
    }
  } catch (error) {
    // Log error but don't propagate to avoid breaking the main flow
    console.warn('Failed to record generation metric:', error);
  }
};

// Recording functions for multi-step metrics
export const recordMultiStepMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  stepsUsed: number,
  maxSteps: number,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (stepsUsed > 1 && instruments.multiStepGenerationsCounter) {
      instruments.multiStepGenerationsCounter.add(1, labels);
    }

    if (instruments.stepsPerGenerationHistogram) {
      instruments.stepsPerGenerationHistogram.record(stepsUsed, labels);
    }

    if (stepsUsed >= maxSteps && instruments.maxStepsReachedCounter) {
      instruments.maxStepsReachedCounter.add(1, labels);
    }
  } catch (error) {
    console.warn('Failed to record multi-step metric:', error);
  }
};

// Recording functions for error correction metrics
export const recordValidationErrorMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  errorType: 'validation' | 'assertion',
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      error_type: errorType,
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (errorType === 'validation' && instruments.validationErrorsCounter) {
      instruments.validationErrorsCounter.add(1, labels);
    }

    if (errorType === 'assertion' && instruments.assertionErrorsCounter) {
      instruments.assertionErrorsCounter.add(1, labels);
    }
  } catch (error) {
    console.warn('Failed to record validation error metric:', error);
  }
};

export const recordRefusalErrorMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      error_type: 'refusal',
      ...(signatureName ? { signature: signatureName } : {}),
    });

    // For now, we'll count refusal errors as validation errors since they trigger retry loops
    if (instruments.validationErrorsCounter) {
      instruments.validationErrorsCounter.add(1, labels);
    }
  } catch (error) {
    console.warn('Failed to record refusal error metric:', error);
  }
};

export const recordErrorCorrectionMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  attempts: number,
  success: boolean,
  maxRetries: number,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      success: success.toString(),
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (instruments.errorCorrectionAttemptsHistogram) {
      instruments.errorCorrectionAttemptsHistogram.record(attempts, labels);
    }

    if (success && instruments.errorCorrectionSuccessCounter) {
      instruments.errorCorrectionSuccessCounter.add(1, labels);
    }

    if (!success) {
      if (instruments.errorCorrectionFailureCounter) {
        instruments.errorCorrectionFailureCounter.add(1, labels);
      }
      if (attempts >= maxRetries && instruments.maxRetriesReachedCounter) {
        instruments.maxRetriesReachedCounter.add(1, labels);
      }
    }
  } catch (error) {
    console.warn('Failed to record error correction metric:', error);
  }
};

// Recording functions for function calling metrics
export const recordFunctionCallingMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  functionsEnabled: boolean,
  functionsExecuted: number,
  hadFunctionCalls: boolean,
  functionErrorCorrection = false,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      functions_enabled: functionsEnabled.toString(),
      had_function_calls: hadFunctionCalls.toString(),
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (functionsEnabled && instruments.functionsEnabledGenerationsCounter) {
      instruments.functionsEnabledGenerationsCounter.add(1, labels);
    }

    if (hadFunctionCalls && instruments.functionCallStepsCounter) {
      instruments.functionCallStepsCounter.add(1, labels);
    }

    if (
      functionsExecuted > 0 &&
      instruments.functionsExecutedPerGenerationHistogram
    ) {
      instruments.functionsExecutedPerGenerationHistogram.record(
        functionsExecuted,
        labels
      );
    }

    if (functionErrorCorrection && instruments.functionErrorCorrectionCounter) {
      instruments.functionErrorCorrectionCounter.add(1, labels);
    }
  } catch (error) {
    console.warn('Failed to record function calling metric:', error);
  }
};

// Recording functions for field processing metrics
export const recordFieldProcessingMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  fieldProcessorsExecuted: number,
  streamingFieldProcessorsExecuted: number,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (
      fieldProcessorsExecuted > 0 &&
      instruments.fieldProcessorsExecutedCounter
    ) {
      instruments.fieldProcessorsExecutedCounter.add(
        fieldProcessorsExecuted,
        labels
      );
    }

    if (
      streamingFieldProcessorsExecuted > 0 &&
      instruments.streamingFieldProcessorsExecutedCounter
    ) {
      instruments.streamingFieldProcessorsExecutedCounter.add(
        streamingFieldProcessorsExecuted,
        labels
      );
    }
  } catch (error) {
    console.warn('Failed to record field processing metric:', error);
  }
};

// Recording functions for streaming metrics
export const recordStreamingMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  isStreaming: boolean,
  deltasEmitted: number,
  finalizationDuration?: number,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      is_streaming: isStreaming.toString(),
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (isStreaming && instruments.streamingGenerationsCounter) {
      instruments.streamingGenerationsCounter.add(1, labels);
    }

    if (deltasEmitted > 0 && instruments.streamingDeltasEmittedCounter) {
      instruments.streamingDeltasEmittedCounter.add(deltasEmitted, labels);
    }

    if (
      finalizationDuration &&
      instruments.streamingFinalizationLatencyHistogram
    ) {
      instruments.streamingFinalizationLatencyHistogram.record(
        finalizationDuration,
        labels
      );
    }
  } catch (error) {
    console.warn('Failed to record streaming metric:', error);
  }
};

// Recording functions for samples metrics
export const recordSamplesMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  samplesCount: number,
  resultPickerUsed: boolean,
  resultPickerLatency?: number,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      result_picker_used: resultPickerUsed.toString(),
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (instruments.samplesGeneratedHistogram) {
      instruments.samplesGeneratedHistogram.record(samplesCount, labels);
    }

    if (resultPickerUsed && instruments.resultPickerUsageCounter) {
      instruments.resultPickerUsageCounter.add(1, labels);
    }

    if (resultPickerLatency && instruments.resultPickerLatencyHistogram) {
      instruments.resultPickerLatencyHistogram.record(
        resultPickerLatency,
        labels
      );
    }
  } catch (error) {
    console.warn('Failed to record samples metric:', error);
  }
};

// Recording functions for signature complexity metrics
export const recordSignatureComplexityMetrics = (
  instruments: Readonly<AxGenMetricsInstruments>,
  inputFields: number,
  outputFields: number,
  examplesCount: number,
  demosCount: number,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      ...(signatureName ? { signature: signatureName } : {}),
    });

    if (instruments.inputFieldsGauge) {
      instruments.inputFieldsGauge.record(inputFields, labels);
    }

    if (instruments.outputFieldsGauge) {
      instruments.outputFieldsGauge.record(outputFields, labels);
    }

    if (instruments.examplesUsedGauge) {
      instruments.examplesUsedGauge.record(examplesCount, labels);
    }

    if (instruments.demosUsedGauge) {
      instruments.demosUsedGauge.record(demosCount, labels);
    }
  } catch (error) {
    console.warn('Failed to record signature complexity metrics:', error);
  }
};

// Recording functions for performance metrics
export const recordPerformanceMetric = (
  instruments: Readonly<AxGenMetricsInstruments>,
  metricType:
    | 'prompt_render'
    | 'extraction'
    | 'assertion'
    | 'state_creation'
    | 'memory_update',
  duration: number,
  signatureName?: string
): void => {
  try {
    const labels = sanitizeLabels({
      metric_type: metricType,
      ...(signatureName ? { signature: signatureName } : {}),
    });

    switch (metricType) {
      case 'prompt_render':
        if (instruments.promptRenderLatencyHistogram) {
          instruments.promptRenderLatencyHistogram.record(duration, labels);
        }
        break;
      case 'extraction':
        if (instruments.extractionLatencyHistogram) {
          instruments.extractionLatencyHistogram.record(duration, labels);
        }
        break;
      case 'assertion':
        if (instruments.assertionLatencyHistogram) {
          instruments.assertionLatencyHistogram.record(duration, labels);
        }
        break;
      case 'state_creation':
        if (instruments.stateCreationLatencyHistogram) {
          instruments.stateCreationLatencyHistogram.record(duration, labels);
        }
        break;
      case 'memory_update':
        if (instruments.memoryUpdateLatencyHistogram) {
          instruments.memoryUpdateLatencyHistogram.record(duration, labels);
        }
        break;
    }
  } catch (error) {
    console.warn('Failed to record performance metric:', error);
  }
};
