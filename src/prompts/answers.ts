import { AIService, AIPrompt, PromptMetadata, PromptAction } from '../text';

const actionNames = (tools: PromptAction[]) =>
  tools.map((v) => v.name).join(', ');

const actionDescriptions = (tools: PromptAction[]) =>
  tools.map((v) => `${v.name}: ${v.description}`).join('\n');

const promptHeader = (
  actions: PromptAction[]
) => `Answer the following questions using the actions listed below:

Actions:

${actionDescriptions(actions)}

Format:

Question: The input question you must answer.
Thought: Always consider what to do.
Action Name: The action to take, choose from [${actionNames(actions)}].
Action Input: The input required for the action.
Observation: The output of the action.

Thought: I now have additional information.
Repeat the previous four steps as necessary.

Thought: I have enough information to answer the original question.
Final Answer: The answer to the original question.

Let's get started!
`;

/**
 * A prompt used for question answering
 *
 * - This prompt is based off the famous RaAct paper.
 * - https://42papers.com/p/react-synergizing-reasoning-and-acting-in-language-models
 * @export
 */
export class QuestionAnswerPrompt implements AIPrompt {
  private acts: PromptAction[];
  private ph: string;

  private _metadata: PromptMetadata = {
    stopSequences: ['Question:', 'Observation:'],
    queryPrefix: '\nObservation: ',
    responsePrefix: '\nThought: ',

    actionName: /^Action Name:\s{0,}\n?(.+)$/m,
    actionValue: /^Action Input:\s{0,}\n?(.+)$/m,
    finalValue: /^Final Answer:((.|\n)*)/m,
  };

  constructor(actions: PromptAction[] = []) {
    this.acts = [...actions];
    this.ph = promptHeader(actions);
  }

  metadata(): Readonly<PromptMetadata> {
    return this._metadata;
  }

  actions(): ReadonlyArray<PromptAction> {
    return this.acts;
  }

  create(query: string, history: () => string, _ai: AIService): string {
    return `
${this.ph}

Question: ${query}
${history()}`;
  }
}
