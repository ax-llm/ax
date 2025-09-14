import { AxAI, AxAIGoogleGeminiModel, ax } from '@ax-llm/ax';

// Setup the prompt program for movie reviews
const gen = ax(
  'movieTitle:string -> rating:number, genres:string[], strengths:string[], weaknesses:string[], recommendedAudience:string, verdict:string'
);

// Assert rating is between 1 and 10 with custom error message
gen.addAssert(({ rating }: Readonly<{ rating: number }>) => {
  if (!rating) return undefined;
  if (rating < 1 || rating > 10) {
    return `Rating ${rating} is out of range. Must be between 1 and 10.`;
  }
  return true;
});

// Assert there are between 1-3 genres with detailed feedback
gen.addAssert(({ genres }: Readonly<{ genres: string[] }>) => {
  if (!genres) return undefined;
  if (genres.length < 1) {
    return 'At least 1 genre must be specified';
  }
  if (genres.length > 3) {
    return `Too many genres specified: ${genres.length}. Maximum is 3 genres.`;
  }
  return true;
});

// Assert strengths and weaknesses are balanced with detailed analysis
gen.addAssert(
  ({
    strengths,
    weaknesses,
  }: Readonly<{ strengths: string[]; weaknesses: string[] }>) => {
    if (!strengths || !weaknesses) return undefined;
    const diff = Math.abs(strengths.length - weaknesses.length);
    if (diff > 1) {
      return `Review is unbalanced: ${strengths.length} strengths vs ${weaknesses.length} weaknesses. Difference should be ≤ 1.`;
    }
    return true;
  }
);

// Assert verdict length with character count feedback
gen.addAssert(({ verdict }: Readonly<{ verdict: string }>) => {
  if (!verdict) return undefined;
  if (verdict.length < 50) {
    return `Verdict too short: ${verdict.length} characters (minimum 50 required)`;
  }
  return true;
});

// Assert recommended audience format with helpful guidance
gen.addAssert(
  ({ recommendedAudience }: Readonly<{ recommendedAudience: string }>) => {
    if (!recommendedAudience) return undefined;
    if (/\d+/.test(recommendedAudience)) {
      return `Recommended audience "${recommendedAudience}" contains specific ages. Use age groups like "teens", "adults", "families" instead.`;
    }
    return true;
  }
);

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
//   config: { model: AxAIOpenAIModel.GPT4OMini },
// })
// ai.setOptions({ debug: true })

// Run the program
const generator = await gen.streamingForward(ai, {
  movieTitle: 'The Grand Budapest Hotel',
});

for await (const res of generator) {
  console.log(res);
}
