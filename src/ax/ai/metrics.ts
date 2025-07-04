import type { Counter, Gauge, Histogram, Meter } from '@opentelemetry/api'

// Utility function to sanitize metric labels
const sanitizeLabels = (
  labels: Record<string, unknown>
): Record<string, string> => {
  const sanitized: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels)) {
    if (value !== undefined && value !== null) {
      const stringValue = String(value)
      // Limit label length to prevent excessive memory usage
      sanitized[key] =
        stringValue.length > 100 ? stringValue.substring(0, 100) : stringValue
    }
  }
  return sanitized
}

export interface AxAIMetricsInstruments {
  latencyHistogram?: Histogram
  errorCounter?: Counter
  requestCounter?: Counter
  tokenCounter?: Counter
  inputTokenCounter?: Counter
  outputTokenCounter?: Counter
  errorRateGauge?: Gauge
  meanLatencyGauge?: Gauge
  p95LatencyGauge?: Gauge
  p99LatencyGauge?: Gauge

  streamingRequestsCounter?: Counter

  functionCallsCounter?: Counter
  functionCallLatencyHistogram?: Histogram

  requestSizeHistogram?: Histogram
  responseSizeHistogram?: Histogram

  temperatureGauge?: Gauge
  maxTokensGauge?: Gauge

  estimatedCostCounter?: Counter

  promptLengthHistogram?: Histogram
  contextWindowUsageGauge?: Gauge

  timeoutsCounter?: Counter
  abortsCounter?: Counter

  thinkingBudgetUsageCounter?: Counter
  multimodalRequestsCounter?: Counter
}

// Singleton instance for AI metrics instruments
let globalAIMetricsInstruments: AxAIMetricsInstruments | undefined

// Function to get or create AI metrics instruments (singleton pattern)
export const getOrCreateAIMetricsInstruments = (
  meter?: Meter
): AxAIMetricsInstruments | undefined => {
  // Return existing instance if available
  if (globalAIMetricsInstruments) {
    return globalAIMetricsInstruments
  }

  if (meter) {
    globalAIMetricsInstruments = createMetricsInstruments(meter)
    return globalAIMetricsInstruments
  }

  return undefined
}

// Function to reset the AI metrics singleton (useful for testing)
export const resetAIMetricsInstruments = (): void => {
  globalAIMetricsInstruments = undefined
}

export const createMetricsInstruments = (
  meter: Meter
): AxAIMetricsInstruments => {
  return {
    latencyHistogram: meter.createHistogram('ax_llm_request_duration_ms', {
      description: 'Duration of LLM requests in milliseconds',
      unit: 'ms',
    }),

    errorCounter: meter.createCounter('ax_llm_errors_total', {
      description: 'Total number of LLM request errors',
    }),

    requestCounter: meter.createCounter('ax_llm_requests_total', {
      description: 'Total number of LLM requests',
    }),

    tokenCounter: meter.createCounter('ax_llm_tokens_total', {
      description: 'Total number of LLM tokens consumed',
    }),

    inputTokenCounter: meter.createCounter('ax_llm_input_tokens_total', {
      description: 'Total number of input/prompt tokens consumed',
    }),

    outputTokenCounter: meter.createCounter('ax_llm_output_tokens_total', {
      description: 'Total number of output/completion tokens generated',
    }),

    errorRateGauge: meter.createGauge('ax_llm_error_rate', {
      description: 'Current error rate as a percentage (0-100)',
    }),

    meanLatencyGauge: meter.createGauge('ax_llm_mean_latency_ms', {
      description: 'Mean latency of LLM requests in milliseconds',
      unit: 'ms',
    }),

    p95LatencyGauge: meter.createGauge('ax_llm_p95_latency_ms', {
      description: '95th percentile latency of LLM requests in milliseconds',
      unit: 'ms',
    }),

    p99LatencyGauge: meter.createGauge('ax_llm_p99_latency_ms', {
      description: '99th percentile latency of LLM requests in milliseconds',
      unit: 'ms',
    }),

    streamingRequestsCounter: meter.createCounter(
      'ax_llm_streaming_requests_total',
      {
        description: 'Total number of streaming LLM requests',
      }
    ),

    functionCallsCounter: meter.createCounter('ax_llm_function_calls_total', {
      description: 'Total number of function/tool calls made',
    }),

    functionCallLatencyHistogram: meter.createHistogram(
      'ax_llm_function_call_latency_ms',
      {
        description: 'Latency of function calls in milliseconds',
        unit: 'ms',
      }
    ),

    requestSizeHistogram: meter.createHistogram('ax_llm_request_size_bytes', {
      description: 'Size of LLM request payloads in bytes',
      unit: 'By',
    }),

    responseSizeHistogram: meter.createHistogram('ax_llm_response_size_bytes', {
      description: 'Size of LLM response payloads in bytes',
      unit: 'By',
    }),

    temperatureGauge: meter.createGauge('ax_llm_temperature_gauge', {
      description: 'Temperature setting used for LLM requests',
    }),

    maxTokensGauge: meter.createGauge('ax_llm_max_tokens_gauge', {
      description: 'Maximum tokens setting used for LLM requests',
    }),

    estimatedCostCounter: meter.createCounter('ax_llm_estimated_cost_total', {
      description: 'Estimated cost of LLM requests in USD',
      unit: '$',
    }),

    promptLengthHistogram: meter.createHistogram('ax_llm_prompt_length_chars', {
      description: 'Length of prompts in characters',
    }),

    contextWindowUsageGauge: meter.createGauge(
      'ax_llm_context_window_usage_ratio',
      {
        description: 'Context window utilization ratio (0-1)',
      }
    ),

    timeoutsCounter: meter.createCounter('ax_llm_timeouts_total', {
      description: 'Total number of timed out LLM requests',
    }),

    abortsCounter: meter.createCounter('ax_llm_aborts_total', {
      description: 'Total number of aborted LLM requests',
    }),

    thinkingBudgetUsageCounter: meter.createCounter(
      'ax_llm_thinking_budget_usage_total',
      {
        description: 'Total thinking budget tokens used',
      }
    ),

    multimodalRequestsCounter: meter.createCounter(
      'ax_llm_multimodal_requests_total',
      {
        description: 'Total number of multimodal requests (with images/audio)',
      }
    ),
  }
}

export const recordLatencyMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  duration: number,
  aiService: string,
  model?: string
): void => {
  try {
    if (instruments.latencyHistogram) {
      const labels = sanitizeLabels({
        operation: type,
        ai_service: aiService,
        ...(model ? { model } : {}),
      })
      instruments.latencyHistogram.record(duration, labels)
    }
  } catch (error) {
    console.warn('Failed to record latency metric:', error)
  }
}

export const recordLatencyStatsMetrics = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  meanLatency: number,
  p95Latency: number,
  p99Latency: number,
  aiService: string,
  model?: string
): void => {
  const labels = {
    operation: type,
    ai_service: aiService,
    ...(model ? { model } : {}),
  }

  if (instruments.meanLatencyGauge) {
    instruments.meanLatencyGauge.record(meanLatency, labels)
  }

  if (instruments.p95LatencyGauge) {
    instruments.p95LatencyGauge.record(p95Latency, labels)
  }

  if (instruments.p99LatencyGauge) {
    instruments.p99LatencyGauge.record(p99Latency, labels)
  }
}

export const recordErrorMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  aiService: string,
  model?: string
): void => {
  try {
    if (instruments.errorCounter) {
      const labels = sanitizeLabels({
        operation: type,
        ai_service: aiService,
        ...(model ? { model } : {}),
      })
      instruments.errorCounter.add(1, labels)
    }
  } catch (error) {
    console.warn('Failed to record error metric:', error)
  }
}

export const recordErrorRateMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  errorRate: number,
  aiService: string,
  model?: string
): void => {
  if (instruments.errorRateGauge) {
    instruments.errorRateGauge.record(errorRate * 100, {
      // Convert to percentage
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordRequestMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  aiService: string,
  model?: string
): void => {
  if (instruments.requestCounter) {
    instruments.requestCounter.add(1, {
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordTokenMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'input' | 'output' | 'total' | 'thoughts',
  tokens: number,
  aiService: string,
  model?: string
): void => {
  try {
    const labels = sanitizeLabels({
      ai_service: aiService,
      ...(model ? { model } : {}),
    })

    // Record in the general token counter with type label
    if (instruments.tokenCounter) {
      instruments.tokenCounter.add(tokens, {
        token_type: type,
        ...labels,
      })
    }

    // Also record in specific counters for input/output
    if (type === 'input' && instruments.inputTokenCounter) {
      instruments.inputTokenCounter.add(tokens, labels)
    }

    if (type === 'output' && instruments.outputTokenCounter) {
      instruments.outputTokenCounter.add(tokens, labels)
    }
  } catch (error) {
    console.warn('Failed to record token metric:', error)
  }
}

export const recordStreamingRequestMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  isStreaming: boolean,
  aiService: string,
  model?: string
): void => {
  if (isStreaming && instruments.streamingRequestsCounter) {
    instruments.streamingRequestsCounter.add(1, {
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordFunctionCallMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  functionName: string,
  latency?: number,
  aiService?: string,
  model?: string
): void => {
  const labels = {
    function_name: functionName,
    ...(aiService ? { ai_service: aiService } : {}),
    ...(model ? { model } : {}),
  }

  if (instruments.functionCallsCounter) {
    instruments.functionCallsCounter.add(1, labels)
  }

  if (latency && instruments.functionCallLatencyHistogram) {
    instruments.functionCallLatencyHistogram.record(latency, labels)
  }
}

export const recordRequestSizeMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  sizeBytes: number,
  aiService: string,
  model?: string
): void => {
  if (instruments.requestSizeHistogram) {
    instruments.requestSizeHistogram.record(sizeBytes, {
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordResponseSizeMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  sizeBytes: number,
  aiService: string,
  model?: string
): void => {
  if (instruments.responseSizeHistogram) {
    instruments.responseSizeHistogram.record(sizeBytes, {
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordModelConfigMetrics = (
  instruments: Readonly<AxAIMetricsInstruments>,
  temperature?: number,
  maxTokens?: number,
  aiService?: string,
  model?: string
): void => {
  const labels = {
    ...(aiService ? { ai_service: aiService } : {}),
    ...(model ? { model } : {}),
  }

  if (temperature !== undefined && instruments.temperatureGauge) {
    instruments.temperatureGauge.record(temperature, labels)
  }

  if (maxTokens !== undefined && instruments.maxTokensGauge) {
    instruments.maxTokensGauge.record(maxTokens, labels)
  }
}

export const recordEstimatedCostMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  costUSD: number,
  aiService: string,
  model?: string
): void => {
  if (instruments.estimatedCostCounter) {
    instruments.estimatedCostCounter.add(costUSD, {
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordPromptLengthMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  lengthChars: number,
  aiService: string,
  model?: string
): void => {
  if (instruments.promptLengthHistogram) {
    instruments.promptLengthHistogram.record(lengthChars, {
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordContextWindowUsageMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  usageRatio: number,
  aiService: string,
  model?: string
): void => {
  if (instruments.contextWindowUsageGauge) {
    instruments.contextWindowUsageGauge.record(usageRatio, {
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordTimeoutMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  aiService: string,
  model?: string
): void => {
  if (instruments.timeoutsCounter) {
    instruments.timeoutsCounter.add(1, {
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordAbortMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  type: 'chat' | 'embed',
  aiService: string,
  model?: string
): void => {
  if (instruments.abortsCounter) {
    instruments.abortsCounter.add(1, {
      operation: type,
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordThinkingBudgetUsageMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  tokensUsed: number,
  aiService: string,
  model?: string
): void => {
  if (instruments.thinkingBudgetUsageCounter) {
    instruments.thinkingBudgetUsageCounter.add(tokensUsed, {
      ai_service: aiService,
      ...(model ? { model } : {}),
    })
  }
}

export const recordMultimodalRequestMetric = (
  instruments: Readonly<AxAIMetricsInstruments>,
  hasImages: boolean,
  hasAudio: boolean,
  aiService: string,
  model?: string
): void => {
  if ((hasImages || hasAudio) && instruments.multimodalRequestsCounter) {
    instruments.multimodalRequestsCounter.add(1, {
      ai_service: aiService,
      has_images: hasImages.toString(),
      has_audio: hasAudio.toString(),
      ...(model ? { model } : {}),
    })
  }
}
