import { AxAI, flow } from '@ax-llm/ax';

// Create an AI instance
const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Create a flow without explicitly passing a signature
// The signature will be inferred from the flow structure
const myFlow = flow()
  .node(
    'analyzer',
    'userText:string -> sentimentValue:string, confidenceScore:number'
  )
  .node(
    'formatter',
    'rawSentiment:string, score:number -> formattedOutput:string'
  )
  .execute('analyzer', (state: any) => ({
    userText: state.userInput,
  }))
  .execute('formatter', (state: any) => ({
    rawSentiment: state.analyzerResult.sentimentValue,
    score: state.analyzerResult.confidenceScore,
  }));

// Execute the flow - this will trigger signature inference
await myFlow.forward(ai, {
  userInput:
    'I absolutely love this new feature! It makes development so much easier.',
});

const complexFlow = flow()
  .node('preprocessor', 'rawText:string -> cleanedText:string')
  .node('sentimentAnalyzer', 'textData:string -> sentiment:string')
  .node('topicExtractor', 'textData:string -> topics:string[]')
  .node(
    'reportGenerator',
    'sentimentData:string, topicData:string[], originalText:string -> finalReport:string'
  )
  .execute('preprocessor', (state: any) => ({
    rawText: state.userInput,
  }))
  .execute('sentimentAnalyzer', (state: any) => ({
    textData: state.preprocessorResult.cleanedText,
  }))
  .execute('topicExtractor', (state: any) => ({
    textData: state.preprocessorResult.cleanedText,
  }))
  .execute('reportGenerator', (state: any) => ({
    sentimentData: state.sentimentAnalyzerResult.sentiment,
    topicData: state.topicExtractorResult.topics,
    originalText: state.userInput,
  }));

await complexFlow.forward(ai, {
  userInput:
    'The new AI features are revolutionary and will change how we approach automation in healthcare and education sectors.',
});

const multiOutputFlow = flow()
  .node(
    'processor',
    'inputText:string -> summary:string, keywords:string[], confidence:number'
  )
  .execute('processor', (state: any) => ({
    inputText: state.userInput,
  }));

await multiOutputFlow.forward(ai, {
  userInput: 'This is a test document with multiple important concepts.',
});
