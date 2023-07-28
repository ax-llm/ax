import { OpenAI, SPrompt } from '@dosco/llm-client';

// import { SPrompt, Anthropic, Cohere, OpenAI } from '@dosco/llm-client';
// import chalk from 'chalk';

// const InitAI = () => {
//   if (process.env.COHERE_APIKEY) {
//     return new Cohere(process.env.COHERE_APIKEY);
//   } else if (process.env.OPENAI_APIKEY) {
//     return new OpenAI(process.env.OPENAI_APIKEY);
//   } else if (process.env.ANTHROPIC_APIKEY) {
//     return new Anthropic(process.env.ANTHROPIC_APIKEY);
//   }
//   throw new Error('No LLM API key found');
// };

const ai = new OpenAI(process.env.OPENAI_APIKEY); // InitAI();

const choice = Math.round(Math.random());

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

const WeatherAPI = ({ location }) => {
  const data = [
    {
      city: 'san francisco',
      weather: choice === 1 ? goodDay : badDay,
    },
    {
      city: 'tokyo',
      weather: choice === 1 ? goodDay : badDay,
    },
  ];

  return data
    .filter((v) => v.city === location.toLowerCase())
    .map((v) => v.weather);
};

const OpentableAPI = ({ location, outdoor, cuisine, priceRange }) => {
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
      outdoor_seating: true,
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
      name: 'Quay',
      city: 'tokyo',
      cuisine: 'sushi',
      rating: 4.6,
      price_range: '$$$$',
      outdoor_seating: true,
    },
    {
      name: 'White Rabbit',
      city: 'tokyo',
      cuisine: 'indian',
      rating: 4.7,
      price_range: '$$$',
      outdoor_seating: true,
    },
  ];

  return data
    .filter((v) => v.city === location?.toLowerCase())
    .sort((a, b) => {
      a.price_range.length - b.price_range.length;
    });
};

// List of functions available to the AI
const funcs = [
  {
    name: 'getCurrentWeather',
    description: 'get the current weather for a location',
    func: WeatherAPI,
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'location to get weather for',
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          default: 'imperial',
          description: 'units to use',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'findRestaurants',
    description: 'find restaurants in a location',
    func: OpentableAPI,
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'location to find restaurants in',
        },
        outdoor: {
          type: 'boolean',
          default: false,
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

const restaurant = {
  type: 'array',
  items: { $ref: '#/definitions/restaurant' },
  definitions: {
    restaurant: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'name of the restaurant' },
        priceRange: { type: 'string', description: 'price range' },
      },
      required: ['name', 'priceRange'],
    },
  },
};

const prompt = new SPrompt(restaurant, funcs);
prompt.setDebug(true);

const customerQuery =
  "I'm looking for ideas for lunch today in San Francisco. I like sushi but I don't want to spend too much or other options are fine as well. Also if its a nice day I'd rather sit outside.";

const res = await prompt.generate(ai, customerQuery);
