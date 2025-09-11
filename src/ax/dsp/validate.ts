import type { AxAIService } from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';

import type { AxPromptTemplate } from './prompt.js';
import type { AxIField } from './sig.js';

export function handleValidationError(
  mem: AxAIMemory,
  errorFields: AxIField[],
  _ai: Readonly<AxAIService>,
  promptTemplate: Readonly<AxPromptTemplate>,
  sessionId?: string
) {
  mem.addRequest(
    [
      {
        role: 'user' as const,
        content: promptTemplate.renderExtraFields(errorFields),
      },
    ],
    sessionId
  );
  mem.addTag('correction', sessionId);

  // Debug logging is now handled in generate.ts through proper structured logging
}
