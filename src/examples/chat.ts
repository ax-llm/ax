import { AxAI, AxAIGoogleGeminiModel, AxGen } from '@ax-llm/ax'

// Initialize Gemini AI
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: {
    model: AxAIGoogleGeminiModel.Gemini25Flash,
    stream: false,
  },
  options: {
    debug: true,
  },
})

// Define conversation types
type UserMessage = { role: 'user'; values: { message: string } }
type AssistantMessage = { role: 'assistant'; values: { reply: string } }
type ChatMessage = UserMessage | AssistantMessage

// Create a simple chat assistant
const chatBot = new AxGen<
  { message: string } | ReadonlyArray<ChatMessage>,
  { reply: string }
>(
  `message:string "A casual message from the user" -> reply:string "A friendly, casual response"`
)

console.log('🤖 Starting casual chat with Gemini...\n')

// Start a casual conversation
const chat: ChatMessage[] = [
  {
    role: 'user',
    values: { message: 'Hi! How are you doing today?' },
  },
]

console.log('👤 User: Hi! How are you doing today?\n')

// Get first response
let response = await chatBot.forward(ai, chat)
console.log(`🤖 Bot: ${response.reply}\n`)

// Add response to chat history
chat.push({ role: 'assistant', values: response })

// Continue the conversation
chat.push({
  role: 'user',
  values: {
    message: "That's great! What's your favorite thing about helping people?",
  },
})

console.log(
  "👤 User: That's great! What's your favorite thing about helping people?\n"
)

response = await chatBot.forward(ai, chat)
console.log(`🤖 Bot: ${response.reply}\n`)

// Add response and continue
chat.push({ role: 'assistant', values: response })

chat.push({
  role: 'user',
  values: { message: 'Cool! Can you tell me a fun fact?' },
})

console.log('👤 User: Cool! Can you tell me a fun fact?\n')

response = await chatBot.forward(ai, chat)
console.log(`🤖 Bot: ${response.reply}\n`)
