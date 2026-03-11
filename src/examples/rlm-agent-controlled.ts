import {
  AxAIOpenAIModel,
  AxJSRuntime,
  agent,
  ai,
  type AxAgentFunction,
} from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
  },
});

const runtime = new AxJSRuntime();

export const workflowTools: AxAgentFunction[] = [
  {
    name: 'finishReply',
    namespace: 'workflow',
    description:
      'Complete the current actor turn from host-side code with the final reply text.',
    parameters: {
      type: 'object',
      properties: {
        reply: {
          type: 'string',
          description: 'Final reply to send back to the user',
        },
      },
      required: ['reply'],
    },
    returns: { type: 'string' },
    func: async ({ reply }: { reply: string }, extra) => {
      extra?.protocol?.final(reply);
      return reply;
    },
  },
  {
    name: 'askForOrderId',
    namespace: 'workflow',
    description:
      'Complete the current actor turn from host-side code by asking the user for the missing order ID.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Clarification question to ask the user',
        },
      },
      required: ['question'],
    },
    returns: { type: 'string' },
    func: async ({ question }: { question: string }, extra) => {
      extra?.protocol?.askClarification(question);
      return question;
    },
  },
];

export const supportAgent = agent('message:string -> reply:string', {
  agentIdentity: {
    name: 'Support Draft Assistant',
    description:
      'Drafts short customer-support replies and asks for missing order IDs when needed.',
  },
  contextFields: [],
  runtime,
  functions: { local: workflowTools },
  actorOptions: {
    description: [
      'This demo intentionally completes turns through host-side workflow functions.',
      'If the message does not include an order ID, call workflow.askForOrderId({ question: "Please share your order ID so I can draft the reply." }).',
      'If the message includes an order ID, draft a concise support reply and call workflow.finishReply({ reply: <draft> }).',
      'Do not call final(...) or ask_clarification(...) directly in actor-authored JavaScript for this demo.',
    ].join('\n'),
  },
  debug: true,
});

const completeResult = await supportAgent.forward(llm, {
  message: 'Order #4812 arrived damaged. Draft a brief support reply.',
});

const clarificationResult = await supportAgent.forward(llm, {
  message: 'My package arrived damaged. What should I send support?',
});

console.log('With order ID:', completeResult.reply);
console.log('Missing order ID:', clarificationResult.reply);
