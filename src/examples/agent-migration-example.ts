import { type AxAgentic, AxJSRuntime, agent, ai } from '@ax-llm/ax';

// Example showing the agent() factory function

// Create an AI instance using the ai() factory function
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

const runtime = new AxJSRuntime();

// Using the agent() factory function with the new simplified API
const weatherAgent = agent(
  'location:string "City or location for weather info" -> weatherInfo:string "Current weather and forecast", temperature:number "Current temperature in Celsius"',
  {
    agentIdentity: {
      name: 'weatherAgent',
      description: 'An agent that provides weather information',
    },
    rlm: {
      contextFields: [],
      runtime,
    },
  }
);
weatherAgent.setActorDescription(
  'You are a helpful weather assistant. When users ask about weather, provide clear, concise information about current conditions, forecasts, and any relevant weather warnings.'
);

// Create child agents using the new syntax
const forecastAgent = agent(
  'location:string -> forecast:string "5-day weather forecast"',
  {
    agentIdentity: {
      name: 'forecastAgent',
      description: 'Provides detailed weather forecasts',
    },
    rlm: {
      contextFields: [],
      runtime,
    },
  }
);

const alertsAgent = agent(
  'location:string -> alerts:string[] "Active weather alerts"',
  {
    agentIdentity: {
      name: 'alertsAgent',
      description: 'Checks for weather warnings and alerts',
    },
    rlm: {
      contextFields: [],
      runtime,
    },
  }
);

// Parent agent that coordinates child agents
const weatherCoordinator = agent(
  'query:string "User weather query" -> response:string "Complete weather response"',
  {
    agentIdentity: {
      name: 'weatherCoordinator',
      description:
        'Coordinates multiple weather agents to provide comprehensive information',
    },
    agents: [weatherAgent, forecastAgent, alertsAgent] as AxAgentic<any, any>[],
    rlm: {
      contextFields: [],
      runtime,
    },
  }
);
weatherCoordinator.setActorDescription(
  'You coordinate weather information requests by delegating to specialized agents for forecasts and alerts. Combine their responses into a comprehensive answer.'
);

// Example usage
console.log('=== Agent Migration Example ===\n');

// Using the weather agent
const result = await weatherAgent.forward(llm, {
  location: 'San Francisco',
});

console.log('Weather Info:', result.weatherInfo);
console.log('Temperature:', result.temperature, '°C\n');

// Using the coordinator with child agents
const coordinatedResult = await weatherCoordinator.forward(llm, {
  query: 'What is the weather like in New York, including any alerts?',
});

console.log('Coordinated Response:', coordinatedResult.response);
