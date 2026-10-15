// ax-example:start
// title: TypeScript Jev Image Localization
// group: generation
// description: Finds a red square using image inputs and Box signature outputs with native confidence.
// provider: typesafe
// env: TYPESAFE_API_KEY, TYPESAFE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
import { readFile } from 'node:fs/promises';
import { ai, ax } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey) throw new Error('Set TYPESAFE_API_KEY or TYPESAFE_APIKEY.');
const model = ai({ name: 'typesafe', apiKey, config: { model: 'jev-1.14.0' } });
// Jev requires at least 78,400 pixels; this synthetic PNG is 384 by 384.
const image = await readFile(
  new URL('../../assets/decision-shapes.png', import.meta.url)
);
const locate = ax(`
  photo:image ->
  visible:boolean "Is there a red square in photo?",
  target:box(evidence) "The red square in photo"
`);
const result = await locate.forward(model, {
  photo: { mimeType: 'image/png', data: image.toString('base64') },
});
// A box is always returned. Only use it when the target is present.
if (result.visible) {
  const { value, confidence, provenance } = result.target;
  console.log({ box: value, confidence, provenance });
  console.log({
    pixels: {
      top: Math.round(value.top * 384),
      bottom: Math.round(value.bottom * 384),
      left: Math.round(value.left * 384),
      right: Math.round(value.right * 384),
    },
  });
} else console.log('The target was not detected.');
