/**
 *
 * This implementation showcases how to reimplement Lares using llmclient to demonstrate the ease of building such agents.
 * Lares is a simulation of a smart home assistant, powered by a simple AI agent.
 * It exhibits problem-solving abilities, despite its simplicity.
 *
 * For more details on emergent behavior in AI agents, see this reference:
 * https://interconnected.org/more/2024/lares/
 */

import {
  AxAI,
  AxJSRuntime,
  type AxFunctionJSONSchema,
  agent,
} from '@ax-llm/ax';

interface RoomState {
  light: boolean;
}

interface HomeState {
  rooms: { [key: string]: RoomState };
  robotLocation: string;
  dogLocation: string;
}

const state: HomeState = {
  rooms: {
    kitchen: { light: false },
    livingRoom: { light: false },
    bedroom: { light: false },
  },
  robotLocation: 'kitchen',
  dogLocation: 'livingRoom',
};

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

const myAgent = agent(
  'instruction -> room:string "the room where the dog is found"',
  {
    functions: {
      local: [
        {
          name: 'toggleLight',
          description: 'Toggle the light in a room',
          parameters: {
            type: 'object',
            properties: {
              room: { type: 'string', description: 'Room to toggle light' },
            },
            required: ['room'],
          } as AxFunctionJSONSchema,
          func: async (args: Readonly<{ room?: string }>) => {
            if (!args?.room) {
              throw new Error('Missing required parameter: room');
            }
            const roomState = state.rooms[args.room];
            if (roomState) {
              roomState.light = !roomState.light;
              console.log(
                `Toggled light in ${args.room}: ${roomState.light ? 'on' : 'off'}`
              );
              return {
                success: true,
                light: roomState.light ? 'on' : 'off',
              };
            }
            return { success: false, message: 'Invalid room' };
          },
        },
        {
          name: 'moveRobot',
          description: 'Move the robot to an adjacent room',
          parameters: {
            type: 'object',
            properties: {
              destination: { type: 'string', description: 'Destination room' },
            },
            required: ['destination'],
          } as AxFunctionJSONSchema,
          func: async (args: Readonly<{ destination: string }>) => {
            if (state.rooms[args.destination]) {
              state.robotLocation = args.destination;
              console.log(`Moved robot to ${args.destination}`);
              return { success: true, location: args.destination };
            }
            return { success: false, message: 'Invalid destination' };
          },
        },
        {
          name: 'lookWithRobot',
          description: 'Look with the robot in its current room',
          parameters: {
            type: 'object',
            properties: {},
          } as AxFunctionJSONSchema,
          func: async () => {
            const location = state.robotLocation;
            const room = state.rooms[location];

            if (room?.light) {
              const items = location === state.dogLocation ? ['dog'] : [];
              console.log(
                `Looking in ${location}: ${items.length ? 'dog found' : 'no dog'}`
              );
              return { success: true, items };
            }
            console.log(`Too dark to see anything in ${location}`);
            return { success: false, message: "It's too dark to see anything" };
          },
        },
      ],
    },
    contextFields: [],
    runtime: new AxJSRuntime(),
  }
);

// Initial state prompt for the LLM
const instruction = `
    You are controlling a smart home with the following rooms: kitchen, livingRoom, bedroom.
    Each room has a light that can be toggled on or off. There is a robot that can move between rooms.
    Your task is to find the dog. You can turn on lights in rooms to see inside them, and move the robot to different rooms.
    The initial state is: ${JSON.stringify({ ...state, dogLocation: 'unknown' })}.
  `;

const res = await myAgent.forward(ai, { instruction });
console.log('Response:', res);
