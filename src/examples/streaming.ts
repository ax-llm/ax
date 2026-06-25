import { AxAIGoogleGeminiModel, ax, ai as createAI } from '@ax-llm/ax';

// Setup the prompt program for movie reviews
const gen = ax(
  'movieTitle:string -> rating:number, genres:string[], strengths:string[], weaknesses:string[], recommendedAudience:string, verdict:string'
);

gen.setInstruction(
  'Review the movie with a 1-10 rating, one to three genres, balanced strengths and weaknesses, and a practical audience recommendation.'
);

const ai = createAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
});

// const ai = createAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
//   config: { model: AxAIOpenAIModel.GPT54Mini },
// })
// ai.setOptions({ debug: true })

// Run the program
const generator = await gen.streamingForward(ai, {
  movieTitle: 'The Grand Budapest Hotel',
});

for await (const res of generator) {
  console.log(res);
}
