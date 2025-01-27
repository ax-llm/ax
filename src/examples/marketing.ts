import { AxAI, AxGen } from '@ax-llm/ax'

const product = {
  name: 'Acme Toilet Cleaning',
  description: '24/7 Commercial and residential restroom cleaning services',
}

const to = {
  name: 'Jerry Doe',
  title: 'Head of facilities and operations',
  company: 'Blue Yonder Inc.',
}

const messageGuidelines = [
  'Under 160 characters',
  'Prompts recipients to book an call',
  'Employs emojis and friendly language',
]

const gen = new AxGen<{
  productName: string
  productDescription: string
  toName: string
  toDescription: string
  messageGuidelines: string
}>(
  `productName, productDescription, toName, toDescription, messageGuidelines -> message`
)

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

const res = await gen.forward(ai, {
  productName: product.name,
  productDescription: product.description,
  toName: to.name,
  toDescription: to.title,
  messageGuidelines: messageGuidelines.join(', '),
})

console.log('>', res)
