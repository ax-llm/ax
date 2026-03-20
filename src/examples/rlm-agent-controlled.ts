import { AxAIOpenAIModel, AxJSRuntime, agent, ai, f, fn } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
  },
});

export const workflowTools = [
  fn('reviewReplyDraft')
    .description(
      'Review a draft reply in host-side code and redirect the actor if a required policy sentence is missing.'
    )
    .namespace('workflow')
    .arg('draft', f.string('Draft reply to review'))
    .arg('message', f.string('Original customer message'))
    .returns(f.string('Review status when the draft is approved'))
    .handler(async ({ draft, message }, extra) => {
      const reviewSource = [message, draft]
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
      const needsPackagingInstruction = /damaged/i.test(reviewSource);
      const mentionsPackaging = /packaging|box/i.test(draft);

      if (needsPackagingInstruction && !mentionsPackaging) {
        extra?.protocol?.guideAgent(
          'Revise the draft to tell the customer to keep the damaged item and its packaging for inspection, then run workflow.reviewReplyDraft again before calling final(...) with the approved reply.'
        );
      }

      return 'approved';
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

export const buildSupportAgent = () =>
  agent('message:string -> reply:string', {
    agentIdentity: {
      name: 'Support Draft Assistant',
      description:
        'Drafts short customer-support replies and asks for missing order IDs when needed.',
    },
    contextFields: [],
    runtime: new AxJSRuntime({
      outputMode: 'return',
    }),
    functions: { local: workflowTools },
    actorOptions: {
      description: [
        'This demo uses host-side workflow functions for review and clarification, then completes successful runs with direct final(...).',
        'Treat order IDs already present in the message as valid, including formats like "#4812", "Order #4812", or "order 4812".',
        'If the message already includes an order ID, do not call workflow.askForOrderId(...). Use the ID from the message and continue the workflow.',
        'Only call workflow.askForOrderId({ question: "Please share your order ID so I can draft the reply." }) when the message truly does not contain any order ID at all.',
        'The built-in demo messages in this file already contain order IDs, so workflow.askForOrderId(...) should never be used during the default run.',
        'If the message includes an order ID, you must draft a reply, then immediately call workflow.reviewReplyDraft({ draft: <draft>, message: inputs.message }) before doing anything else.',
        'Use the exact lowercase field name `inputs.message`, not `inputs.Message`.',
        'After workflow.reviewReplyDraft(...) returns "approved", immediately call final(<approved reply>) in actor-authored JavaScript.',
        'For damaged-item messages, treat workflow.reviewReplyDraft(...) as a required gate. Never skip it, even if the draft already looks complete.',
        'If host guidance interrupts the turn after workflow.reviewReplyDraft(...), follow that guidance on the next turn, revise the reply, re-run workflow.reviewReplyDraft(...), and then call final(...) once it is approved.',
        'Do not call ask_clarification(...) directly in actor-authored JavaScript for this demo.',
      ].join('\n'),
    },
    debug: true,
  });

const guidedAgent = buildSupportAgent();
const guidedResult = await guidedAgent.forward(llm, {
  message: 'Order #4812 arrived damaged. Draft a brief support reply.',
});

const secondAgent = buildSupportAgent();
const secondResult = await secondAgent.forward(llm, {
  message:
    'Order #5931 was damaged in transit. Draft a short support reply that tells me what to send support.',
});

console.log('Guided reply:', guidedResult.reply);
console.log('Second reply:', secondResult.reply);
