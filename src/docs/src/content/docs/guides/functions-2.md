---
title: Functions Part 2
description: How to use functions with Ax
---

Function calling is a powerful ability of modern LLMs. The way it works is you provide the LLM a set of function specifications that it can then use as needed. This is complex to implement on your own as it requires multi-step interactions that are different across LLMs. Ax makes this very simple; just create a prompt, provide it a set of functions, and it’ll automatically just work.

## Restaurant finding agent

Let's create an agent to help find a restaurant based on the diner's preferences. To do this, we'll start by creating some dummy APIs specifically for this example. We’ll need a function to get the weather, and another one to look up places to eat at.

```typescript title="Weather data function"
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

// dummy weather lookup function
const weatherAPI = ({ location }: Readonly<{ location: string }>) => {
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
```

```typescript title="Restaurant search function"
// dummy opentable api
const opentableAPI = ({
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
```

The function parameters must be defined in JSON schema for the AI to read and understand.

```typescript
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
          type: 'string'
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          description: 'units to use'
        }
      },
      required: ['location']
    }
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
          type: 'string'
        },
        outdoor: {
          type: 'boolean',
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
```

Let's use this agent.

```typescript
const customerQuery =
  "Give me an ideas for lunch today in San Francisco. I like sushi but I don't want to spend too much or other options are fine as well. Also if its a nice day I'd rather sit outside.";

const ai = new Ax({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

const agent = new AxAgent(ai, {
  name: 'Restaurant search agent'
  description:
    'Search for restaurants to dine at based on the weather and food preferences',
  signature:
    `customerQuery:string  -> restaurant:string, priceRange:string "use $ signs to indicate price range"`
    functions,

});

const res = await agent.forward({ customerQuery });
console.log(res);
```

```console title="Run the agent and see the output"
npm run tsx src/examples/food-search.ts

{
  restaurant: 'Sukiyabashi Jiro',
  priceRange: '$$'
}
```
