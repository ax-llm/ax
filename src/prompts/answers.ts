import { AIService, AIPrompt, PromptMetadata, PromptAction } from '../text';

const promptHeader = (actions: PromptAction[], context?: string) => {
  const actn = actions.map((v) => v.name).join(', ');
  const actd = actions.map((v) => `${v.name}: ${v.description}`).join('\n');

  return `
Answer the following question using the actions below. Think step-by-step.

Actions:
${actd}

Format:
Question: The input question you must answer.
Thought: Always consider what to do.
Action: The action to take, choose from [${actn}].
Action Input: The input required for the action.
Observation: The output of the action.

Thought: I now have additional information.
Repeat the previous four steps as necessary.

Thought: I have the final answer
Final Answer: The answer to the original question.

${context ? `\nContext:"""\n${context}\n"""` : ''}

Start!`;
};

/**
 * A prompt used for question answering
 *
 * - This prompt is based off the famous RaAct paper.
 * - https://42papers.com/p/react-synergizing-reasoning-and-acting-in-language-models
 * @export
 */
export class QuestionAnswerPrompt implements AIPrompt {
  private acts: PromptAction[];
  private context?: string;

  private _metadata: PromptMetadata = {
    stopSequences: ['Question:', 'Observation:'],
    queryPrefix: '\nObservation: ',
    responsePrefix: '\nThought: ',

    actionName: /^Action:\s{0,}\n?(.+)$/m,
    actionValue: /^Action Input:\s{0,}\n?(.+)$/m,
    finalValue: /^Final Answer:((.|\n)*)/m,
  };

  constructor(actions: PromptAction[] = [], context?: string) {
    this.acts = [...actions];
    this.context = context;
  }

  metadata(): Readonly<PromptMetadata> {
    return this._metadata;
  }

  actions(): ReadonlyArray<PromptAction> {
    return this.acts;
  }

  create(query: string, history: () => string, _ai: AIService): string {
    return `
${promptHeader(this.acts, this.context)}

Question: ${query}
${history()}
${this._metadata.responsePrefix}
`;
  }
}
