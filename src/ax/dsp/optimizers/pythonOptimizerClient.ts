import type { AxLoggerFunction } from '../../ai/types.js';

// Python optimizer service API types
export interface PythonOptimizationParameter {
  name: string;
  type: 'float' | 'int' | 'categorical';
  low?: number;
  high?: number;
  choices?: (string | number | boolean)[];
  step?: number;
  log?: boolean;
}

export interface PythonOptimizationRequest {
  study_name?: string;
  parameters: PythonOptimizationParameter[];
  objective: {
    name: string;
    direction: 'minimize' | 'maximize';
  };
  n_trials: number;
  timeout?: number;
  sampler?: string;
  pruner?: string;
  metadata?: Record<string, unknown>;
}

export interface PythonOptimizationJob {
  job_id: string;
  study_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
}

export interface PythonJobStatus {
  job_id: string;
  study_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  result?: PythonOptimizationResult;
}

export interface PythonTrial {
  number: number;
  value?: number;
  params: Record<string, string | number | boolean>;
  state: string;
  datetime_start?: string;
  datetime_complete?: string;
  duration?: number;
}

export interface PythonOptimizationResult {
  study_name: string;
  best_trial?: PythonTrial;
  best_value?: number;
  best_params?: Record<string, string | number | boolean>;
  trials: PythonTrial[];
  n_trials: number;
  direction: 'minimize' | 'maximize';
}

export interface PythonParameterSuggestion {
  trial_number: number;
  params: Record<string, string | number | boolean>;
}

export interface PythonEvaluationRequest {
  study_name: string;
  trial_number: number;
  value: number;
  intermediate_values?: Record<number, number>;
}

export interface PythonOptimizerClientOptions {
  endpoint: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  logger?: AxLoggerFunction;
}

/**
 * HTTP client for the Python optimizer service
 */
export class PythonOptimizerClient {
  private endpoint: string;
  private timeout: number;
  private retryAttempts: number;
  private retryDelay: number;
  private logger?: AxLoggerFunction;

  constructor(options: PythonOptimizerClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = options.timeout ?? 30000; // 30 seconds default
    this.retryAttempts = options.retryAttempts ?? 3;
    this.retryDelay = options.retryDelay ?? 1000; // 1 second
    this.logger = options.logger;
  }

  /**
   * Check if the optimizer service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry('/health', {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
      this.logger?.({
        name: 'Notification',
        id: 'health_check_failed',
        value: `Health check failed: ${error}`,
      });
      return false;
    }
  }

  /**
   * Create a new optimization job
   */
  async createOptimizationJob(
    request: PythonOptimizationRequest
  ): Promise<PythonOptimizationJob> {
    const response = await this.fetchWithRetry('/optimize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create optimization job: ${error}`);
    }

    return response.json() as Promise<PythonOptimizationJob>;
  }

  /**
   * Get job status and results
   */
  async getJobStatus(jobId: string): Promise<PythonJobStatus> {
    const response = await this.fetchWithRetry(`/jobs/${jobId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get job status: ${error}`);
    }

    return response.json() as Promise<PythonJobStatus>;
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    const response = await this.fetchWithRetry(`/jobs/${jobId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to cancel job: ${error}`);
    }
  }

  /**
   * Get parameter suggestions for the next trial
   */
  async suggestParameters(
    studyName: string
  ): Promise<PythonParameterSuggestion> {
    const response = await this.fetchWithRetry(
      `/studies/${studyName}/suggest`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to suggest parameters: ${error}`);
    }

    return response.json() as Promise<PythonParameterSuggestion>;
  }

  /**
   * Report trial evaluation result
   */
  async evaluateTrial(request: PythonEvaluationRequest): Promise<void> {
    const response = await this.fetchWithRetry(
      `/studies/${request.study_name}/evaluate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to evaluate trial: ${error}`);
    }
  }

  /**
   * Get optimization results for a study
   */
  async getStudyResults(studyName: string): Promise<PythonOptimizationResult> {
    const response = await this.fetchWithRetry(
      `/studies/${studyName}/results`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get study results: ${error}`);
    }

    return response.json() as Promise<PythonOptimizationResult>;
  }

  /**
   * Delete a study
   */
  async deleteStudy(studyName: string): Promise<void> {
    const response = await this.fetchWithRetry(`/studies/${studyName}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete study: ${error}`);
    }
  }

  /**
   * List all studies
   */
  async listStudies(): Promise<string[]> {
    const response = await this.fetchWithRetry('/studies', {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list studies: ${error}`);
    }

    return response.json() as Promise<string[]>;
  }

  /**
   * Wait for job completion with polling
   */
  async waitForJobCompletion(
    jobId: string,
    pollInterval: number = 2000,
    maxWaitTime: number = 300000 // 5 minutes default
  ): Promise<PythonJobStatus> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getJobStatus(jobId);

      if (['completed', 'failed', 'cancelled'].includes(status.status)) {
        return status;
      }

      this.logger?.({
        name: 'Notification',
        id: 'job_status',
        value: `Job ${jobId} status: ${status.status}, waiting...`,
      });
      await this.sleep(pollInterval);
    }

    throw new Error(`Job ${jobId} did not complete within ${maxWaitTime}ms`);
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(
    path: string,
    options: RequestInit
  ): Promise<Response> {
    const url = `${this.endpoint}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        lastError = error as Error;
        this.logger?.({
          name: 'Notification',
          id: 'retry_attempt',
          value: `Attempt ${attempt + 1} failed: ${error}`,
        });

        if (attempt < this.retryAttempts - 1) {
          await this.sleep(this.retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    throw new Error(
      `Request failed after ${this.retryAttempts} attempts: ${lastError?.message}`
    );
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
