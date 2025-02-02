import {
  AxAgent,
  AxAI,
  AxAIAnthropicModel,
  AxAIGoogleGeminiModel,
  type AxFunction,
  AxFunctionError,
  AxSignature,
} from '@ax-llm/ax'

// Restaurant booking function with validation
const bookRestaurantAPI = ({
  date,
  time,
  partySize,
}: Readonly<{
  date: string
  time: string
  partySize: string
}>) => {
  const errors: { field: string; message: string }[] = []

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(date)) {
    errors.push({
      field: 'date',
      message: 'Date must be in YYYY-MM-DD format',
    })
  }

  // Validate time format (HH:MM)
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/
  if (!timeRegex.test(time)) {
    errors.push({
      field: 'time',
      message: 'Time must be in 24-hour HH:MM format',
    })
  }

  if (!['small', 'medium', 'large'].includes(partySize)) {
    errors.push({
      field: 'partySize',
      message: 'Party size must be small, medium, or large',
    })
  }

  // If any validation errors, throw AxFunctionError
  if (errors.length > 0) {
    throw new AxFunctionError(errors)
  }

  // If validation passes, proceed with booking
  return {
    success: true,
    confirmation: `Booking confirmed for ${partySize} people on ${date} at ${time}`,
    details: {
      reservationId: Math.random().toString(36).substring(7),
      restaurant: 'Sample Restaurant',
    },
  }
}

// List of functions available to the AI
const functions: AxFunction[] = [
  {
    name: 'bookRestaurant',
    description:
      'Book a restaurant reservation. Date must be YYYY-MM-DD, time must be HH:MM in 24-hour format',
    func: bookRestaurantAPI,
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Reservation date in YYYY-MM-DD format',
        },
        time: {
          type: 'string',
          description: 'Reservation time in HH:MM 24-hour format',
        },
        partySize: {
          type: 'string',
          description: 'Number of people',
        },
      },
      required: ['date', 'time', 'partySize'],
    },
  },
]

// Define the signature for the booking agent
const signature = new AxSignature(
  `customerQuery:string -> plan:string "detailed plan to book the restaurant", 
   confirmationNumber:string "reservation confirmation number", 
   details:string "booking details including date, time, and party size"`
)

// Create the booking agent
const gen = new AxAgent<
  { customerQuery: string },
  { confirmationNumber: string; details: string }
>({
  name: 'restaurant-booking',
  description:
    'Use this agent to book restaurant reservations. Must use the provided functions to book a table',
  signature,
  functions,
})

// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
//   config: { stream: true },
// })

const ai = new AxAI({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY as string,
  config: { stream: true, model: AxAIAnthropicModel.Claude35Haiku },
})

// const ai = new AxAI({
//   name: 'google-gemini',
//   apiKey: process.env.GOOGLE_APIKEY as string,
//   config: { stream: true, model: AxAIGoogleGeminiModel.Gemini15Flash },
// })

// const ai = new AxAI({
//   name: 'cohere',
//   apiKey: process.env.COHERE_APIKEY as string,
//   config: { stream: false },
// })

ai.setOptions({ debug: true })

// Example error case
const invalidQuery = 'Book me a table for 25 people at 8:30 PM on 2025/02/01'

const res = await gen.forward(ai, { customerQuery: invalidQuery })
console.log(res)
