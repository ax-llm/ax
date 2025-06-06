import { AxAI, AxGen } from '@ax-llm/ax'

// Create a text classifier with multiple output fields
const classifier = new AxGen<
  { contentToClassify: string },
  { category: string; confidence: number; reasoning?: string }
>(
  `contentToClassify:string "The text content that needs to be classified" -> 
   category:class "news, tech, sports, entertainment" "The category of the text",
   confidence:number "Confidence score between 0 and 1",
   reasoning?:string "Optional reasoning for the classification"`
)

// Demonstrate the new optionalOutputFields feature:
// Some examples can have missing 'confidence' and 'reasoning' fields
classifier.setExamples(
  [
    {
      contentToClassify:
        'Apple announces new iPhone with revolutionary AI features',
      category: 'tech',
      confidence: 0.95,
      reasoning: 'Clear technology product announcement',
    },
    {
      contentToClassify: 'Lakers win championship in dramatic overtime victory',
      category: 'sports',
      // Missing confidence and reasoning - this is now allowed!
    },
    {
      contentToClassify: 'Breaking: Major policy changes announced in Congress',
      category: 'news',
      confidence: 0.92,
      // Missing reasoning - this is now allowed!
    },
    {
      contentToClassify: 'New blockbuster movie breaks box office records',
      category: 'entertainment',
      confidence: 0.96,
      reasoning: 'Entertainment industry news about movie performance',
    },
  ],
  {
    // This is the key new feature: specify which output fields can be missing in examples
    optionalOutputFields: ['confidence', 'reasoning'],
  }
)

// Initialize AI
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

// Test the classification
const result = await classifier.forward(ai, {
  contentToClassify: 'Scientists discover quantum computing breakthrough',
})

console.log('Classification result:', result)
