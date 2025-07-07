import {
  ax,
  AxAI,
  AxAIGoogleGeminiModel,
  type AxFunction,
  type AxMessage,
  f,
} from '@ax-llm/ax'

// Weather function for testing function calls
const getCurrentWeather = async (
  args: Readonly<{ location: string; units?: string }>
) => {
  // Simulate weather API call
  const weatherData = {
    tokyo: { temp: 22, condition: 'Sunny', humidity: 65 },
    'new york': { temp: 18, condition: 'Cloudy', humidity: 70 },
    london: { temp: 15, condition: 'Rainy', humidity: 85 },
    default: { temp: 20, condition: 'Pleasant', humidity: 60 },
  }

  const location = args.location.toLowerCase()
  const weather =
    weatherData[location as keyof typeof weatherData] || weatherData.default
  const unit = args.units === 'metric' ? '°C' : '°F'

  return `The weather in ${args.location} is ${weather.temp}${unit} and ${weather.condition} with ${weather.humidity}% humidity.`
}

// Define available functions
const functions: AxFunction[] = [
  {
    name: 'getCurrentWeather',
    description: 'Get current weather information for a specific location',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city or location to get weather for',
        },
        units: {
          type: 'string',
          enum: ['metric', 'imperial'],
          description:
            'Temperature units (metric for Celsius, imperial for Fahrenheit)',
        },
      },
      required: ['location'],
    },
    func: getCurrentWeather,
  },
]

// Initialize Gemini AI
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: {
    model: AxAIGoogleGeminiModel.Gemini25Flash,
  },
  options: {
    debug: true,
  },
})

// Create a chat assistant with function calling capability using modern template literals
const chatBot = ax`
  message:${f.string('A casual message from the user')} -> 
  reply:${f.string('A friendly, casual response that can include weather information when requested')}
`

console.log('🤖 Starting casual chat with Gemini (with function calling)...\n')

// Start a casual conversation
const chat: AxMessage<{ message: string }>[] = [
  {
    role: 'user',
    values: { message: 'Hi! How are you doing today?' },
  },
]

console.log('👤 User: Hi! How are you doing today?\n')

// Get first response
let response = await chatBot.forward(ai, chat, { functions })
console.log(`🤖 Bot: ${response.reply}\n`)

// Add response to chat history
chat.push({ role: 'assistant', values: { message: response.reply as string } })

// Test function calling with weather request
chat.push({
  role: 'user',
  values: {
    message: "That's great! What's the weather like in Tokyo right now?",
  },
})

console.log(
  "👤 User: That's great! What's the weather like in Tokyo right now?\n"
)

response = await chatBot.forward(ai, chat, {
  functions,
  functionCall: 'required',
})
console.log(`🤖 Bot: ${response.reply}\n`)

// Add response and continue
chat.push({ role: 'assistant', values: { message: response.reply as string } })

chat.push({
  role: 'user',
  values: {
    message:
      'How about the weather in New York? And can you tell me a fun fact?',
  },
})

console.log(
  '👤 User: How about the weather in New York? And can you tell me a fun fact?\n'
)

response = await chatBot.forward(ai, chat, {
  functions,
  functionCall: 'required',
})
console.log(`🤖 Bot: ${response.reply}\n`)
