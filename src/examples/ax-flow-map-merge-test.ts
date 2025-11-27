import { AxAI, flow } from '@ax-llm/ax';

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

const flowWithMap = flow()
  .node('processor', 'inputText:string -> processedData:string')
  .execute('processor', (state: any) => ({ inputText: state.userInput }))
  .map((state: any) => ({
    finalResult: `Processed: ${state.processorResult.processedData}`,
    timestamp: new Date().toISOString(),
  }));

try {
  await flowWithMap.forward(ai, { userInput: 'test input' });
} catch (_error) {
  // silent
}

const flowWithMerge = flow({ autoParallel: false })
  .node('analyzer', 'inputText:string -> isComplex:boolean')
  .node('simpleProcessor', 'inputText:string -> processedText:string')
  .node('complexProcessor', 'inputText:string -> processedText:string')
  .execute('analyzer', (state: any) => ({ inputText: state.userInput }))
  .branch((state: any) => state.analyzerResult.isComplex)
  .when(true)
  .execute('complexProcessor', (state: any) => ({ inputText: state.userInput }))
  .when(false)
  .execute('simpleProcessor', (state: any) => ({ inputText: state.userInput }))
  .merge();

try {
  await flowWithMerge.forward(ai, {
    userInput: 'complex analysis needed',
  });
} catch (_error) {
  // silent
}

const flowWithParallelMerge = flow({ autoParallel: false })
  .node('processor1', 'inputText:string -> processedText1:string')
  .node('processor2', 'inputText:string -> processedText2:string')
  .parallel([
    (subFlow: any) =>
      subFlow.execute('processor1', (state: any) => ({
        inputText: state.userInput,
      })),
    (subFlow: any) =>
      subFlow.execute('processor2', (state: any) => ({
        inputText: state.userInput,
      })),
  ])
  .merge('combinedResults', (result1: any, result2: any) => ({
    combined: [
      result1.processor1Result?.processedText1,
      result2.processor2Result?.processedText2,
    ],
  }));

try {
  await flowWithParallelMerge.forward(ai, {
    userInput: 'parallel processing',
  });
} catch (_error) {
  // silent
}
