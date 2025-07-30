import { describe, expect, it } from 'vitest';

import { flow } from './flow.js';

describe('AxFlowBuilder fluent API', () => {
  it('should create a flow with nodes and execute methods', () => {
    const workflow = flow<{ userInput: string }>()
      .node('summarizer', 'documentText:string -> summaryText:string')
      .node('analyzer', 'summaryContent:string -> analysisResult:string')
      .execute('summarizer', (state) => ({
        documentText: state.userInput || 'test',
      }))
      .execute('analyzer', (state) => ({
        summaryContent: state.summarizerResult?.summaryText || 'test summary',
      }))
      .map((state) => ({
        finalResult: state.analyzerResult?.analysisResult || 'test result',
      }));

    expect(workflow).toBeDefined();
    expect(typeof workflow.forward).toBe('function');
  });

  it('should support different node creation methods', () => {
    const workflow = flow<{ sourceText: string }>().node(
      'textProcessor',
      'userInput:string -> processedOutput:string'
    );

    expect(workflow).toBeDefined();
  });

  it('should support method chaining with type inference', () => {
    // This test mainly ensures that the TypeScript compilation works correctly
    const workflow = flow<{ userInput: string }>()
      .node('step1', 'userInput:string -> intermediateResult:string')
      .execute('step1', (state) => ({ userInput: state.userInput || 'test' }))
      .map((state) => ({
        finalResult: state.step1Result?.intermediateResult || 'default',
      }));

    expect(workflow).toBeDefined();
  });

  it('should support configuration options', () => {
    const workflow = flow<{ sourceData: string }>({
      autoParallel: true,
      batchSize: 5,
      debug: false,
    }).node('processor', 'sourceData:string -> processedResult:string');

    expect(workflow).toBeDefined();
  });

  it('should support basic flow operations', () => {
    const workflow = flow<{ userInput: string }>()
      .node('classifier', 'documentText:string -> categoryType:string')
      .execute('classifier', (state) => ({
        documentText: state.userInput || 'test',
      }))
      .map((state) => ({
        classification: state.classifierResult?.categoryType || 'unknown',
      }));

    expect(workflow).toBeDefined();
  });

  it('should support map transformations', () => {
    const workflow = flow<{ sourceData: string }>()
      .node('processor1', 'userInput:string -> firstOutput:string')
      .node('processor2', 'processedInput:string -> secondOutput:string')
      .execute('processor1', (state) => ({
        userInput: state.sourceData || 'test1',
      }))
      .execute('processor2', (state) => ({
        processedInput: state.processor1Result?.firstOutput || 'test2',
      }))
      .map((state) => ({
        combined: `${state.processor1Result?.firstOutput || ''} + ${state.processor2Result?.secondOutput || ''}`,
      }));

    expect(workflow).toBeDefined();
  });
});
