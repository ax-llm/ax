import test from 'ava';

import { AxAI } from '../ai/index.js';
import { AxSignature } from '../dsp/sig.js';

import { AxChainOfThought } from './cot.js';

const someText = `The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible.`;

const examples = [
  {
    someText:
      'Mathematical platonism is a philosophical view that posits the existence of abstract mathematical objects that are independent of human thought and language. According to this view, mathematical entities such as numbers, shapes, and functions exist in a non-physical realm and can be discovered but not invented.',
    shortSummary:
      'A philosophy that suggests mathematical objects exist independently of human thought in a non-physical realm.'
  },
  {
    someText:
      'Quantum entanglement is a physical phenomenon occurring when pairs or groups of particles are generated, interact, or share spatial proximity in ways such that the quantum state of each particle cannot be described independently of the state of the others, even when the particles are separated by large distances. This leads to correlations between observable physical properties of the particles.',
    shortSummary:
      'A phenomenon where particles remain interconnected and the state of one affects the state of another, regardless of distance.'
  }
];

const mockFetch = async (): Promise<Response> => {
  const mockRes = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Reason: Blah blah blah\nShort Summary: More blah blah blah'
        }
      }
    ]
  };

  return new Promise((resolve) => {
    resolve({
      ok: true,
      status: 200,
      json: async () => new Promise((resolve) => resolve(mockRes))
    } as unknown as Response);
  });
};

test('generate prompt', async (t) => {
  const options = { fetch: mockFetch };
  const ai = new AxAI({
    name: 'openai',
    apiKey: 'no-key',
    options
  });

  // const ai = new AxAI({ name: 'ollama', config: { model: 'nous-hermes2' } });

  const gen = new AxChainOfThought(
    ai,
    `someText -> shortSummary "summarize in 5 to 10 words"`
  );
  gen.setExamples(examples);

  const res = await gen.forward({ someText }, { stream: false });

  t.deepEqual(res, {
    reason: 'Blah blah blah',
    shortSummary: 'More blah blah blah'
  });
});

test('generate prompt: invalid signature', async (t) => {
  t.throws(() => new AxSignature(`someText -> output:image`));
});
