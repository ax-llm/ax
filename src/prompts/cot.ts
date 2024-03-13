import { OpenAI } from '../ai/index.js';
import { Generate, GenerateOptions, Signature } from '../dsp/index.js';
import { AIService } from '../text/types.js';

export class ChainOfThought extends Generate {
  constructor(
    ai: Readonly<AIService>,
    signature: Readonly<Signature | string>,
    options?: Readonly<GenerateOptions>
  ) {
    super(ai, signature, options);

    this.setSignature((sig) => {
      const outputs = sig
        .getOutputFields()
        .map((f) => `\`${f.name}\``)
        .join(', ');

      const description = `Let's think step by step in order to produce ${outputs}. We ...`;

      sig.addOutputField({
        name: 'reason',
        description,
        type: { name: 'string', isArray: false }
      });
    });
  }
}

const apiKey = process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('OpenAI API key is required.');
}
const ai = new OpenAI({ apiKey });
const cot = new ChainOfThought(
  ai,
  `
  context:string[] "Information to answer the question",
  question:string
  ->
  answer:string[]`
);

const values = {
  question: 'What is the capital of France?',
  context: [
    'Paris is the capital and most populous city of France. Situated on the Seine River, in the north of the country, it is in the centre of the Île-de-France region, also known as the région parisienne, "Paris Region"',
    'France is a unitary semi-presidential republic with its capital in Paris, the countrys largest city and main cultural and commercial centre; other major '
  ]
};

const res = await cot.forward(values);
console.log(res);
