import {
  AxAIGoogleGeminiModel,
  type AxAgentFunction,
  AxJSRuntime,
  agent,
  ai,
  s,
} from '../ax/index.js';

const weatherAPI = (_: Readonly<{ location: string }>) => {
  const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Snowy'];
  const temp = Math.floor(Math.random() * 30) + 5;
  const condition = conditions[Math.floor(Math.random() * conditions.length)];
  return { temperature: `${temp}C`, condition };
};

const timeAPI = (_: Readonly<{ location: string }>) => {
  const hours = Math.floor(Math.random() * 24);
  const minutes = Math.floor(Math.random() * 60);
  return { time: `${hours}:${minutes.toString().padStart(2, '0')}` };
};

const stockAPI = (_: Readonly<{ symbol: string }>) => {
  const price = (Math.random() * 1000).toFixed(2);
  return { price: `$${price}`, change: '+1.2%' };
};

const functions: AxAgentFunction[] = [
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
      },
      required: ['location'],
    },
  },
  {
    name: 'getCurrentTime',
    description: 'get the current time for a location',
    func: timeAPI,
    parameters: {
      type: 'object',
      properties: {
        location: {
          description: 'location to get time for',
          type: 'string',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'getStockPrice',
    description: 'get the current stock price for a symbol',
    func: stockAPI,
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          description: 'stock symbol (e.g. AAPL, GOOG)',
          type: 'string',
        },
      },
      required: ['symbol'],
    },
  },
];

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Pro,
    thinking: { thinkingLevel: 'high', thinkingTokenBudget: 200 },
  },
});

llm.setOptions({ debug: true });

// Query designed to trigger multiple parallel function calls across different tools
const customerQuery =
  'Compare the weather and time in Tokyo, New York, London, and Paris. Also check the stock prices for AAPL, GOOG, and MSFT.';

const sig = s(
  `customerQuery:string -> report:string "comprehensive report comparing weather, time and stock prices"`
);

const gen = agent(sig, {
  functions: { local: functions },
  contextFields: [],
  runtime: new AxJSRuntime(),
});

console.log('Running complex parallel function call test...');

try {
  const res = await gen.forward(
    llm,
    { customerQuery },
    {
      debug: true,
      stream: false,
    }
  );
  console.log('\n\nResult:', res);
} catch (e) {
  console.error('\n\nError:', e);
}
