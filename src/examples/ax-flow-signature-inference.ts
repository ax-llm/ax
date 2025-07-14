import { AxAI, AxFlow } from '@ax-llm/ax';

// Example: Creating an AxFlow that infers its signature from node dependencies
console.log('=== AxFlow Signature Inference Demo ===');

// Create an AI instance
const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Create a flow without explicitly passing a signature
// The signature will be inferred from the flow structure
const flow = new AxFlow()
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

// Before execution: The flow will infer its signature based on the dependencies
console.log(
  'Flow signature before execution (temporary):',
  flow.getSignature().toString()
);

// Execute the flow - this will trigger signature inference
const result = await flow.forward(ai, {
  userInput:
    'I absolutely love this new feature! It makes development so much easier.',
});

// After execution: The signature has been inferred from the flow structure
console.log(
  'Flow signature after execution (inferred):',
  flow.getSignature().toString()
);
console.log('Final result:', result);

// Demonstrate with a more complex flow
console.log('\n=== Complex Flow with Multiple Dependencies ===');

const complexFlow = new AxFlow()
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

const complexResult = await complexFlow.forward(ai, {
  userInput:
    'The new AI features are revolutionary and will change how we approach automation in healthcare and education sectors.',
});

console.log(
  'Complex flow inferred signature:',
  complexFlow.getSignature().toString()
);
console.log('Complex flow result:', complexResult);

// Test with multiple output fields
console.log('\n=== Flow with Multiple Output Fields ===');

const multiOutputFlow = new AxFlow()
  .node(
    'processor',
    'inputText:string -> summary:string, keywords:string[], confidence:number'
  )
  .execute('processor', (state: any) => ({
    inputText: state.userInput,
  }));

const multiOutputResult = await multiOutputFlow.forward(ai, {
  userInput: 'This is a test document with multiple important concepts.',
});

console.log(
  'Multi-output flow inferred signature:',
  multiOutputFlow.getSignature().toString()
);
console.log('Multi-output flow result:', multiOutputResult);
