import { AxAgent, AxAI, type AxFunction, AxSignature } from '@ax-llm/ax';

const goodDay = {
  temperature: '27C',
  description: 'Clear Sky',
  wind_speed: 5.1,
  humidity: 56,
};

const badDay = {
  temperature: '10C',
  description: 'Cloudy',
  wind_speed: 10.6,
  humidity: 70,
};

const weatherAPI = (_: Readonly<{ location: string }>) => {
  return Math.random() > 0.5 ? goodDay : badDay;
};

const opentableAPI = ({
  priceRange,
}: Readonly<{
  cuisine: string;
  priceRange: string;
}>) => {
  const data = [
    {
      name: "Gordon Ramsay's",
      city: 'san francisco',
      cuisine: 'indian',
      rating: 4.8,
      price_range: '$$$$$$',
      outdoor_seating: true,
    },
    {
      name: 'Sukiyabashi Jiro',
      city: 'san francisco',
      cuisine: 'sushi',
      rating: 4.7,
      price_range: '$$',
      outdoor_seating: false,
    },
    {
      name: 'Oyster Bar',
      city: 'san francisco',
      cuisine: 'seafood',
      rating: 4.5,
      price_range: '$$',
      outdoor_seating: true,
    },
    {
      name: 'China Express',
      city: 'san francisco',
      cuisine: 'chinese',
      rating: 4.6,
      price_range: '$$$$',
      outdoor_seating: true,
    },
    {
      name: 'White Rabbit',
      city: 'san francisco',
      cuisine: 'indian',
      rating: 4.7,
      price_range: '$$$',
      outdoor_seating: true,
    },
  ];

  return data.filter((v) => v.price_range === priceRange);
};

// List of functions available to the AI
const functions: AxFunction[] = [
  {
    name: 'getCurrentWeather',
    description: 'get the current weather for a location',
    func: weatherAPI,
    parameters: {
      type: 'object',
      properties: {
        location: {
          description: 'location to get weather for',
          type: 'string',
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          description: 'units to use',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'findRestaurants',
    description: 'find restaurants in a location',
    func: opentableAPI,
    parameters: {
      type: 'object',
      properties: {
        location: {
          description: 'location to find restaurants in',
          type: 'string',
        },
        outdoor: {
          type: 'boolean',
          description: 'outdoor seating',
        },
        cuisine: { type: 'string', description: 'cuisine type' },
        priceRange: {
          type: 'string',
          enum: ['$', '$$', '$$$', '$$$$'],
          description: 'price range',
        },
      },
      required: ['location', 'outdoor', 'cuisine', 'priceRange'],
    },
  },
];

// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
//   config: { stream: true },
// });

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: {
    // model: AxAIGoogleGeminiModel.Gemini25Pro,
    stream: false,
    thinking: { thinkingTokenBudget: 200 },
  },
});

// const ai = new AxAI({
//     name: 'openai-responses',
//     apiKey: process.env.OPENAI_APIKEY as string,
//     config: { stream: true },
// })

// const ai = new AxAI({
//   name: 'groq',
//   apiKey: process.env.GROQ_APIKEY as string,
//   config: { stream: false },
// })

// const ai = new AxAI({
//     name: 'cohere',
//     apiKey: process.env.COHERE_APIKEY as string,
//     config: { stream: false },
// })

// const ai = new AxAI({
//     name: 'anthropic',
//     apiKey: process.env.ANTHROPIC_APIKEY as string,
//     config: { stream: true },
// })

ai.setOptions({ debug: true });

const customerQuery =
  "Give me an ideas for lunch today in San Francisco. I like sushi, chinese, indian. Also if its a nice day I'd rather sit outside. Find me something.";

const signature = new AxSignature(
  `customerQuery:string  -> plan: string "detailed plan to find a place to eat", restaurant:string, priceRange:string "use $ signs to indicate price range"`
);

const gen = new AxAgent<
  { customerQuery: string },
  { restaurant: string; priceRange: string }
>({
  name: 'food-search',
  description:
    'Use this agent to find restaurants based on what the customer wants. Use the provided functions to get the weather and find restaurants and finally return the best match',
  signature,
  functions,
});

const res = await gen.forward(ai, { customerQuery });

console.log('\n\n>', res);
