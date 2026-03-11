import { AxAIOpenAIModel, AxJSRuntime, agent, ai, f, fn } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
  },
});

const runtime = new AxJSRuntime();

export const workflowTools = [
  fn('finishReply')
    .description(
      'Complete the current actor turn from host-side code with the final reply text.'
    )
    .namespace('workflow')
    .arg('reply', f.string('Final reply to send back to the user'))
    .returns(f.string('Final reply text'))
    .handler(async ({ reply }, extra) => {
      extra?.protocol?.final(reply);
      return reply;
    })
    .build(),
  fn('askForOrderId')
    .description(
      'Complete the current actor turn from host-side code by asking the user for the missing order ID.'
    )
    .namespace('workflow')
    .arg('question', f.string('Clarification question to ask the user'))
    .returns(f.string('Clarification question'))
    .handler(async ({ question }, extra) => {
      extra?.protocol?.askClarification(question);
      return question;
    })
    .build(),
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
