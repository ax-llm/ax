import {
  Memory,
  ExtractInfoPrompt,
  BusinessInfo,
  Anthropic,
  Together,
  Cohere,
  OpenAI,
} from '@dosco/llm-client';

const InitAI = () => {
  if (process.env.COHERE_APIKEY) {
    return new Cohere(process.env.COHERE_APIKEY);
  } else if (process.env.OPENAI_APIKEY) {
    return new OpenAI(process.env.OPENAI_APIKEY);
  } else if (process.env.TOGETHER_APIKEY) {
    return new Together(process.env.TOGETHER_APIKEY);
  } else if (process.env.ANTHROPIC_APIKEY) {
    return new Anthropic(process.env.ANTHROPIC_APIKEY);
  }
  throw new Error('No LLM API key found');
};

const ai = InitAI();

const entities = [
  { name: BusinessInfo.ProductName },
  { name: BusinessInfo.IssueDescription },
  { name: BusinessInfo.IssueSummary },
  { name: BusinessInfo.PaymentMethod, classes: ['Cash', 'Credit Card'] },
];

const mem = new Memory();
const prompt = new ExtractInfoPrompt(entities);

const customerMessage = `
Hello Support Team,

I am writing to report an issue with my recent order #12345. I received the package yesterday, but unfortunately, the product that I paid for with cash (XYZ Smartwatch) is not functioning properly. When I tried to turn it on, the screen remained blank, and I couldn't get it to respond to any of the buttons.

I have already tried resetting the device multiple times, but the issue persists. I believe there may be a defect with the product, and I would like to request a replacement or refund. Please let me know what steps I should take to proceed with the return or exchange process. I have attached a copy of the order confirmation and shipping confirmation for your reference.

Thank you for your attention to this matter.

Best regards,
John Doe.
  `;

const res = await prompt.generate(ai, customerMessage, { mem });

console.log(
  `Customer Message:\n${customerMessage}\n\nExtracted Details From Customer Message:\n`,
  res.value()
);
