// ax-example:start
// title: TypeScript OpenAI Image Decisions
// group: generation
// description: Evaluates a synthetic red square with native Decisions and an Ax boolean signature.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 46
// ax-example:end
import { ai, ax, openaiDecisions } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');
// A synthetic 128-by-128 solid red PNG; no external image file is needed.
const image =
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABWklEQVR4nO3OQQ0AMBAEofVv+iqDxzRBALvtg/wgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwg7gEgaMOyrMtNTwAAAABJRU5ErkJggg==';
const decision = await openaiDecisions({ apiKey }).create({
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Inspect this color square.' },
        { type: 'input_image', image_url: `data:image/png;base64,${image}` },
      ],
    },
  ],
  questions: [
    {
      type: 'predicate',
      name: 'predominantly_red',
      instructions: 'Is the image predominantly red?',
    },
  ],
});
const answer = decision.answers[0];
if (answer.type === 'refusal')
  throw new Error(`Question refused: ${answer.name}`);
console.log({ probability: answer.probability });

const inspect = ax(
  'productPhoto:image -> predominantlyRed:boolean "Is the image predominantly red?"'
);
const values = await inspect.forward(ai({ name: 'openai-decisions', apiKey }), {
  productPhoto: { mimeType: 'image/png', data: image },
});
if (typeof values.predominantlyRed !== 'boolean')
  throw new Error('Invalid image decision.');
console.log(values);
