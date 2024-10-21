import { AxAI, AxAIOpenAIModel, AxChainOfThought } from '@ax-llm/ax';

const noteText = `The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] According to the most popular version of the singularity hypothesis, I.J. Good's intelligence explosion model, an upgradable intelligent agent will eventually enter a "runaway reaction" of self-improvement cycles, each new and more intelligent generation appearing more and more rapidly, causing an "explosion" in intelligence and resulting in a powerful superintelligence that qualitatively far surpasses all human intelligence.[4]`;

// const ai = new AxAI({ name: 'ollama', model: 'nous-hermes2' });

const gen = new AxChainOfThought(
  ai,
  `noteText -> shortSummary "summarize in 5 to 10 words"`
);
gen.setExamples([
  {
    noteText:
      'Mathematical platonism is a philosophical view that posits the existence of abstract mathematical objects that are independent of human thought and language. According to this view, mathematical entities such as numbers, shapes, and functions exist in a non-physical realm and can be discovered but not invented.',
    shortSummary:
      'A philosophy that suggests mathematical objects exist independently of human thought in a non-physical realm.'
  },
  {
    noteText:
      'Quantum entanglement is a physical phenomenon occurring when pairs or groups of particles are generated, interact, or share spatial proximity in ways such that the quantum state of each particle cannot be described independently of the state of the others, even when the particles are separated by large distances. This leads to correlations between observable physical properties of the particles.',
    shortSummary:
      'A phenomenon where particles remain interconnected and the state of one affects the state of another, regardless of distance.'
  }
]);

gen.addAssert(({ reason }: Readonly<{ reason: string }>) => {
  if (!reason) return true;
  return !reason.includes('goat');
}, 'Reason should not contain "the"');

// Example with OpenAI using custom labels in place of model names
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: 'model-a' },
  modelMap: {
    'model-a': AxAIOpenAIModel.GPT4OMini
  }
});

const res = await gen.forward(
  ai,
  { noteText },
  { modelConfig: { stream: true } }
);

console.log('>', res);
