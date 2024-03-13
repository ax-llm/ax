import { Generate } from '../dsp/index.js';
import { AIService } from '../text/types.js';

export class SummarizePrompt extends Generate {
  constructor(ai: Readonly<AIService>) {
    super(ai, 'text -> summary');
  }
}
