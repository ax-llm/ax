import type { AxAIService } from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';

import type { AxPromptTemplate } from './prompt.js';
import type { AxIField } from './sig.js';

export function handleValidationError(
  mem: AxAIMemory,
  errorFields: AxIField[],
  ai: Readonly<AxAIService>,
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
  mem.addTag('error', sessionId);

  if (ai.getOptions().debug) {
    const errors = errorFields
      .map((field) => `- ${field.title}: ${field.description}`)
      .join('\n');

    const logger = ai.getLogger();
    logger(`❌ Error Correction:\n${errors}`, {
      tags: ['error'],
    });
  }
}
