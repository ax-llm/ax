import {
  axDefaultFlowLogger,
  ai as createAI,
  flow as createFlow,
} from '@ax-llm/ax';

// Create an AI instance (using OpenAI as an example)
const ai = createAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY ?? '',
});

// Create a flow with verbose logging enabled
const flow = createFlow<{ userQuery: string }, { finalAnswer: string }>({
  logger: axDefaultFlowLogger,
})
  .node(
    'analyzer',
    'userQuery:string -> analysisResult:string, complexity:number'
  )
  .node(
    'responder',
    'analysisResult:string, complexity:number -> response:string'
  )
  .execute('analyzer', (state) => ({
    userQuery: state.userQuery,
  }))
  .execute('responder', (state) => ({
    analysisResult: state.analyzerResult.analysisResult,
    complexity: state.analyzerResult.complexity,
  }))
  .map((state) => ({
    finalAnswer: state.responderResult.response,
  }));

// Execute the flow with verbose logging
console.log('🚀 Starting AxFlow with verbose logging...\n');

const result = await flow.forward(ai, {
  userQuery: 'What are the benefits of renewable energy?',
});

console.log('\n✅ Flow completed successfully!');
console.log('Final result:', result);
