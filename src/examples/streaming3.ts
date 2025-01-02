import { AxAI, AxChainOfThought } from '@ax-llm/ax';

// Setup the prompt program for movie reviews
const gen = new AxChainOfThought<{ movieTitle: string }>(
  `movieTitle:string -> 
   rating:number,
   genres:string[], 
   strengths:string[], 
   weaknesses:string[], 
   recommendedAudience:string,
   verdict:string`
);

// Assert rating is between 1 and 10
gen.addAssert(({ rating }: Readonly<{ rating: number }>) => {
  if (!rating) return undefined;
  return rating >= 1 && rating <= 10;
}, 'Rating must be between 1 and 10');

// Assert there are between 1-3 genres
gen.addAssert(({ genres }: Readonly<{ genres: string[] }>) => {
  if (!genres) return undefined;
  return genres.length >= 1 && genres.length <= 3;
}, 'Must specify between 1-3 genres');

// Assert strengths and weaknesses are balanced (similar length arrays)
gen.addAssert(
  ({
    strengths,
    weaknesses
  }: Readonly<{ strengths: string[]; weaknesses: string[] }>) => {
    if (!strengths || !weaknesses) return undefined;
    const diff = Math.abs(strengths.length - weaknesses.length);
    return diff <= 1;
  },
  'Review should be balanced with similar number of strengths and weaknesses'
);

// Assert verdict is not too short
gen.addAssert(({ verdict }: Readonly<{ verdict: string }>) => {
  if (!verdict) return undefined;
  return verdict.length >= 50;
}, 'Verdict must be at least 50 characters');

// Assert recommended audience doesn't mention specific age numbers
gen.addAssert(
  ({ recommendedAudience }: Readonly<{ recommendedAudience: string }>) => {
    if (!recommendedAudience) return undefined;
    return !/\d+/.test(recommendedAudience);
  },
  'Use age groups (e.g. "teens", "adults") instead of specific ages'
);

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string
});
// ai.setOptions({ debug: true });

// Run the program
const res = await gen.forward(ai, { movieTitle: 'The Grand Budapest Hotel' });

console.log('>', res);
