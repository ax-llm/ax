import { AxAI, AxAIGoogleGeminiModel, AxGen, AxSignature } from '@ax-llm/ax'

// const ai = new AxAI({ name: 'ollama', model: 'nous-hermes2' });

const signature = new AxSignature(`\
    updates:string[] \
    -> \
    summary:string, summaryTitle:string, shortSummary:string`)

const gen = new AxGen<
  { updates: string[] },
  { summary: string; summaryTitle: string; shortSummary: string }
>(signature)
gen.setExamples([
  {
    updates: [
      'title: PPG Santa Monica Class Schedule Update summary: Ping Pong For Good modified their class schedule in Santa Monica due to the Santa Monica YMCA community center room being used as a resource center. Mondays are postponed until further notice, and Fridays are now 1 pm-2:15 pm at the Santa Monica YMCA indoor basketball court. Members unable to attend Fridays can temporarily suspend their membership by emailing info@pingpongforgood.org. Sponsorship opportunities are available for additional tables at alternate locations.',
      'title: Major League Table Tennis Matches in Pomona – Jan 17-19, 2025 | 20% Off Tickets! summary: Major League Table Tennis (MLTT) is having matches in Pomona, CA from January 17-19, 2025 at the Pomona Fairplex. Tickets can be purchased at https://mltt.com/tickets/pomona2025/ with a 20% discount using code PPFG.',
      'title: Open Play Session at Santa Monica College  summary: Open play session at Santa Monica College on Sunday, January 26, 2025 from 12:00-1:30pm. The cost is $6 (cash preferred).',
    ],
    summaryTitle:
      'Ping Pong For Good Updates: Schedule Changes, MLTT Pomona Matches, & Open Play',
    summary:
      'Ping Pong For Good (PPG) announces updates affecting their Santa Monica classes (Mondays postponed, Fridays relocated & times adjusted), a 20% discount on Major League Table Tennis (MLTT) matches in Pomona (Jan 17-19, 2025), and an open play session at Santa Monica College on January 26, 2025. PPG members affected by the schedule changes can temporarily suspend their memberships. Sponsorship opportunities are also available for PPG.',
    shortSummary:
      'Ping Pong For Good (PPG) announces updates affecting their Santa Monica Class, MLTT Pomona Matches, & Open Play Session',
  },
])

// gen.addAssert(({ reason }: Readonly<{ reason: string }>) => {
//   if (!reason) return true
//   return !reason.includes('goat')
// }, 'Reason should not contain "the"')

// Example with OpenAI using custom labels in place of model names
// const ai = new AxAI({
//   name: 'openai',
//   apiKey: process.env.OPENAI_APIKEY as string,
//   config: { model: 'model-a' },
//   models: [
//     {
//       key: 'model-a',
//       model: AxAIOpenAIModel.GPT4OMini,
//       description: 'A model that is good for general purpose',
//     },
//   ],
// })

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { maxTokens: 1000, model: AxAIGoogleGeminiModel.Gemini20FlashLite },
})
// ai.setOptions({ debug: true })

// const generator = gen.streamingForward(ai, { noteText })

// console.log('## Streaming')

// for await (const res of generator) {
//   console.log(res)
// }

const updates = [
  `Title: Purrfect Playtime Schedule Change at Cat Cafe
Summary: The Purrfect Paws Cat Cafe has adjusted its daily playtime schedule due to renovations in the main lounge. Monday cuddle sessions are temporarily paused, and Friday afternoon play sessions are now from 3:00 PM to 4:15 PM in the newly renovated sunroom. Customers unable to attend the Friday slot can request a temporary pause on their reservation package by emailing purr@purrfectpaws.com. Sponsorships for additional cat trees and toys at alternative locations are available.`,

  `Title: National Feline Agility Competition in Pasadena – Feb 22-24, 2025 | 15% Off Tickets!
Summary: The National Feline Agility Competition (NFAC) is hosting its championship event in Pasadena, CA from February 22-24, 2025 at the Pasadena Convention Center. Tickets can be purchased at https://nationalfelineagility.com/tickets/pasadena2025/ with a 15% discount using the code MEOW15.`,

  `Title: Open Cat Social Hour at Westwood Animal Shelter
Summary: Open cat social hour at the Westwood Animal Shelter on Sunday, February 2, 2025 from 2:00 PM to 3:30 PM. A $5 donation is requested (cash donations preferred).`,
]

console.log('## Streaming')

const generator = gen.streamingForward(ai, { updates })

for await (const res of generator) {
  console.log(res)
}

console.log('\n\n## Not Streaming')

const res = await gen.forward(ai, { updates })
console.log(res)
