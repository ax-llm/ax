import {
  AxAI,
  AxAIAnthropicModel,
  AxAIOpenAIModel,
  AxBalancer,
  AxChainOfThought
} from '@ax-llm/ax';

const text = `The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] According to the most popular version of the singularity hypothesis, I.J. Good's intelligence explosion model, an upgradable intelligent agent will eventually enter a "runaway reaction" of self-improvement cycles, each new and more intelligent generation appearing more and more rapidly, causing an "explosion" in intelligence and resulting in a powerful superintelligence that qualitatively far surpasses all human intelligence.[4]`;

// modelMap and embedModelMap allows you to use common names for models across different AI services
// is works without the balancer as well.

const ai1 = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  modelMap: {
    chill: AxAIOpenAIModel.GPT35Turbo,
    genius: AxAIOpenAIModel.GPT4Turbo
  }
});

const ai2 = new AxAI({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY as string,
  modelMap: {
    chill: AxAIAnthropicModel.Claude3Haiku,
    genius: AxAIAnthropicModel.Claude35Sonnet
  }
});

const ai = new AxBalancer([ai1, ai2]);

const gen = new AxChainOfThought(
  ai,
  `text -> shortSummary "summarize in 5 to 10 words"`
);

const res = await gen.forward({ text }, { model: 'chill' });

console.log('>', res);
