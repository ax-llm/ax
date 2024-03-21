import { AI, type OpenAIArgs, ReAct, Signature } from '../index.js';

const choice = Math.round(Math.random());

const goodDay = {
  temperature: '27C',
  description: 'Clear Sky',
  wind_speed: 5.1,
  humidity: 56
};

const badDay = {
  temperature: '10C',
  description: 'Cloudy',
  wind_speed: 10.6,
  humidity: 70
};

const WeatherAPI = ({ location }: Readonly<{ location: string }>) => {
  const data = [
    {
      city: 'san francisco',
      weather: choice === 1 ? goodDay : badDay
    },
    {
      city: 'tokyo',
      weather: choice === 1 ? goodDay : badDay
    }
  ];

  return data
    .filter((v) => v.city === location.toLowerCase())
    .map((v) => v.weather);
};

const OpentableAPI = ({
  location
}: Readonly<{
  location: string;
  outdoor: string;
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
      outdoor_seating: true
    },
    {
      name: 'Sukiyabashi Jiro',
      city: 'san francisco',
      cuisine: 'sushi',
      rating: 4.7,
      price_range: '$$',
      outdoor_seating: true
    },
    {
      name: 'Oyster Bar',
      city: 'san francisco',
      cuisine: 'seafood',
      rating: 4.5,
      price_range: '$$',
      outdoor_seating: true
    },
    {
      name: 'Quay',
      city: 'tokyo',
      cuisine: 'sushi',
      rating: 4.6,
      price_range: '$$$$',
      outdoor_seating: true
    },
    {
      name: 'White Rabbit',
      city: 'tokyo',
      cuisine: 'indian',
      rating: 4.7,
      price_range: '$$$',
      outdoor_seating: true
    }
  ];

  return data
    .filter((v) => v.city === location?.toLowerCase())
    .sort((a, b) => {
      return a.price_range.length - b.price_range.length;
    });
};

// List of functions available to the AI
const functions = [
  {
    name: 'getCurrentWeather',
    description: 'get the current weather for a location',
    func: WeatherAPI,
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'location to get weather for'
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          default: 'imperial',
          description: 'units to use'
        }
      },
      required: ['location']
    }
  },
  {
    name: 'findRestaurants',
    description: 'find restaurants in a location',
    func: OpentableAPI,
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'location to find restaurants in'
        },
        outdoor: {
          type: 'boolean',
          default: false,
          description: 'outdoor seating'
        },
        cuisine: { type: 'string', description: 'cuisine type' },
        priceRange: {
          type: 'string',
          enum: ['$', '$$', '$$$', '$$$$'],
          description: 'price range'
        }
      },
      required: ['location', 'outdoor', 'cuisine', 'priceRange']
    }
  }
];

const customerQuery =
  "Give me an ideas for lunch today in San Francisco. I like sushi but I don't want to spend too much or other options are fine as well. Also if its a nice day I'd rather sit outside.";

const sig = new Signature(
  `customerQuery:string  -> restaurant:string, priceRange:string "use $ signs to indicate price range"`
);

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const gen = new ReAct(ai, sig, { functions });
const res = await gen.forward({ customerQuery });

console.log('>', res);
