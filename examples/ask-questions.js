import { Cohere, OpenAI, Memory, QuestionAnswerPrompt } from '@dosco/minds';

const ai = process.env.COHERE_APIKEY
  ? new Cohere(process.env.COHERE_APIKEY)
  : new OpenAI(process.env.OPENAI_APIKEY);

// Fake search action to simulate a api call to google search
const googleSearch = (_text) => {
  return `
  The following big companies are in Mountain View:
  Confluent, 2K employees,
  Intuit, 14K employees,
  Google, 100K employees,
  Linkedin, 21K employees`;
};

// List of actions available to the AI
const actions = [
  {
    name: 'Google Search',
    description:
      'useful for when you need to answer questions about current events',
    action: googleSearch,
  },
];

const prompt = new QuestionAnswerPrompt(actions);
prompt.setDebug(true);

const res = await prompt.generate(
  ai,
  'What are the name of the biggest tech company in Mountain View, CA?'
);

console.log('>', res.value());
