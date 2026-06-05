import { AxAIOpenAIModel, ax, ai as createAI } from '@ax-llm/ax';

const llm = createAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});

const gen = ax('question:string -> answerInPoints:string');

gen.addStreamingAssert(
  'answerInPoints',
  (value) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 4)
      .every((line) => /^\d+\./.test(line)),
  'Each list item must start with a number and a dot.'
);

const stream = await gen.streamingForward(llm, {
  question:
    'Provide a list of 3 optimizations to speed up LLM inference. Keep each one short.',
});

for await (const chunk of stream) {
  console.log(chunk);
}
