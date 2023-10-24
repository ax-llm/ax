import { Anthropic, Together, Cohere, OpenAI } from 'llmclient';

import 'dotenv/config';

const InitAI = () => {
  if (process.env.OPENAI_APIKEY) {
    return new OpenAI(process.env.OPENAI_APIKEY);
  } else if (process.env.TOGETHER_APIKEY) {
    return new Together(process.env.TOGETHER_APIKEY);
  } else if (process.env.ANTHROPIC_APIKEY) {
    return new Anthropic(process.env.ANTHROPIC_APIKEY);
  }
  throw new Error('No LLM API key found');
};

const ai = InitAI();

try {
  const stream = await ai.chat({ 
    chatPrompt: [{ role: 'user', text: 'Tell me a joke' }] 
  }, { stream: true }) 

  for await (const v of stream) {
    const val = v.results[0].text
    if (val.length > 0) {
      process.stdout.write(val, "utf-8")
    }
  }
  console.log("\n")
} catch (error) {
  console.error("ERROR:", error)
}

