import type { AxOptimizationStats } from './optimizer.js';

// Optimizer logging types
export type AxOptimizerLoggerData =
  | {
      name: 'OptimizationStart';
      value: {
        optimizerType: string;
        config: Record<string, unknown>;
        exampleCount: number;
        validationCount: number;
      };
    }
  | {
      name: 'RoundProgress';
      value: {
        round: number;
        totalRounds: number;
        currentScore: number;
        bestScore: number;
        configuration: Record<string, unknown>;
      };
    }
  | {
      name: 'EarlyStopping';
      value: {
        reason: string;
        finalScore: number;
        round: number;
      };
    }
  | {
      name: 'OptimizationComplete';
      value: {
        optimizerType?: string;
        bestScore: number;
        bestConfiguration: Record<string, unknown>;
        totalCalls?: number;
        successRate?: string;
        explanation?: string;
        recommendations?: string[];
        performanceAssessment?: string;
        stats: AxOptimizationStats;
      };
    }
  | {
      name: 'ConfigurationProposal';
      value: {
        type: 'instructions' | 'demos' | 'general';
        proposals: string[] | Record<string, unknown>[];
        count: number;
      };
    }
  | {
      name: 'BootstrappedDemos';
      value: {
        count: number;
        demos: unknown[];
      };
    }
  | {
      name: 'BestConfigFound';
      value: {
        config: Record<string, unknown>;
        score: number;
      };
    };

export type AxOptimizerLoggerFunction = (data: AxOptimizerLoggerData) => void;
