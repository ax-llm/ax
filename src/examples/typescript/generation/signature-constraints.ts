// ax-example:start
// title: TypeScript Signature Constraints
// group: generation
// description: Uses fluent validation constraints and the extended string grammar with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
import { AxAIOpenAIModel, ai, ax, f, s } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT54Mini,
    temperature: 0,
  },
});

const bookingSignature = f()
  .input('requestText', f.string('Booking request').min(10).max(500))
  .input('contactEmail', f.string('Contact email').email())
  .output('partySize', f.number('Guests').min(1).max(12))
  .output(
    'bookingCode',
    f
      .string('Three letters, a dash, and four digits')
      .regex('^[A-Z]{3}-\\d{4}$', 'Must look like ABC-1234')
  )
  .output(
    'guestProfile',
    f.object({
      fullName: f.string('Primary guest').min(2),
      dietaryNotes: f.string('Dietary requirements').optional(),
    })
  )
  .build();

const extendedStringSignature = s(
  'requestText:string -> booking:object{ bookingCode:string(pattern "^[A-Z]{3}-\\\\d{4}$" "ABC-1234"), partySize:number(min 1, max 12) }'
);

const result = await ax(bookingSignature).forward(llm, {
  requestText: 'Book dinner for four people under the name Ada Lovelace.',
  contactEmail: 'ada@example.com',
});

console.log(extendedStringSignature.toString());
console.log(JSON.stringify(result, null, 2));
