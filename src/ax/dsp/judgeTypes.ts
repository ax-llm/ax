import type { AxAIService } from '../ai/types.js';
import type { AxProgramForwardOptions } from './types.js';

export type AxJudgeForwardOptions = Omit<
  AxProgramForwardOptions<string>,
  'functions' | 'description'
>;

export interface AxJudgeOptions extends AxJudgeForwardOptions {
  ai: AxAIService;
  criteria?: string;
  description?: string;
  randomizeOrder?: boolean;
}
