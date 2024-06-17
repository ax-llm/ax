import { axAI, type AxOpenAIArgs } from '../ai/index.js';
import { AxGenerate } from '../dsp/generate.js';

const ai = axAI('openai', {
  apiKey: process.env.OPENAI_APIKEY
} as AxOpenAIArgs);

const gen = new AxGenerate(
  ai,
  `customerEmail:string  -> productName:string "The name of the product",
issueDescription:string "A description of the issue",
issueSummary:string "A summary of the issue",
paymentMethod:string "The method of payment"
`
);

const customerMessage = `
Hello Support Team,

I am writing to report an issue with my recent order #12345. I received the package yesterday, but unfortunately, the product that I paid for with cash (XYZ Smartwatch) is not functioning properly. When I tried to turn it on, the screen remained blank, and I couldn't get it to respond to any of the buttons.

I have already tried resetting the device multiple times, but the issue persists. I believe there may be a defect with the product, and I would like to request a replacement or refund. Please let me know what steps I should take to proceed with the return or exchange process. I have attached a copy of the order confirmation and shipping confirmation for your reference.

Thank you for your attention to this matter.

Best regards,
John Doe.
  `;

console.log(await gen.forward({ customerEmail: customerMessage }));
