import { JSONSchemaType } from 'ajv';

import { AIPrompt } from '../text/text.js';
import { PromptFunction } from '../text/types.js';

/**
 * A prompt that uses json schema defintions to define the expected output
 * @export
 */

export class SPrompt<S> extends AIPrompt<S> {
  private functionsJSON = '';
  private resultSchemaJSON = '';

  constructor(
    resultSchema: Readonly<JSONSchemaType<S>>,
    functions: PromptFunction[] = []
  ) {
    super({
      functions,
      stopSequences: [],
      responseConfig: { schema: resultSchema },
    });

    if (functions.length > 0) {
      this.functionsJSON = this.functionsSchema();
    }
    this.resultSchemaJSON = JSON.stringify(resultSchema, null, 2);
  }

  functionsPrompt(query: string, history: () => string): string {
    return `
  Functions:
  ${this.functionsJSON}

  Use functions. Stick to these steps without creating custom functions. For functions stick to the defined format.

  Steps:
  Thought: Plan the approach.
  Function Call: functionName(parameters in json)
  Result: Function result.
  Thought: Review the outcome and decide next steps using results.
  Repeat steps 2-4 until nearing solution.
  Finally:
  
  Thought: Prepare for the final result.
  Function Call: finalResult(parameters in json)
  
  Task:
  ${query}

  Start!

  ${history()}
  
  Thought: 
  `;
  }

  resultSchemaPrompt(query: string, history: () => string): string {
    return `
  ${query}

  Result Schema:
  ${this.resultSchemaJSON}

  ${history()}
     `;
  }

  override prompt(query: string, history: () => string): string {
    if (this.functionsJSON !== '') {
      return this.functionsPrompt(query, history);
    }

    if (this.resultSchemaJSON !== '') {
      return this.resultSchemaPrompt(query, history);
    }

    return super.prompt(query, history);
  }
}

export { PromptFunction };

// Old prompt
/*
To solve the below task think step-by-step in the format below. Use only below listed functions. Do not create custom functions. Function parameters are in json as per the functions json schema.

Functions:
${functionsJSON}

Format:
Thought: Consider what to do.
Function Call: functionName(parameters)
Result: Function result.
Thought: Use the result to solve the task.
Repeat previous four steps as necessary.

Thought: Return final result.
Function Call: finalResult(parameters)

Task:
*/
