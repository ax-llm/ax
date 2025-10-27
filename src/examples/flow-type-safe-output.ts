// Example: Type-safe output with AxFlow using mapOutput()
// This example shows how to achieve end-to-end type safety in AxFlow

import { ai, flow } from '@ax-llm/ax';

// Create an AI service
const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Example: Building a type-safe document analysis workflow
const documentAnalyzer = flow<{ documentText: string }>()
  .description(
    'Type-safe Document Analyzer',
    'Summarizes, analyzes sentiment, and extracts keywords with typed output.'
  )
  // Define reusable nodes
  .node('summarizer', 'documentText:string -> summaryText:string')
  .node(
    'sentimentAnalyzer',
    'textContent:string -> sentiment:class "positive, negative, neutral" "Sentiment analysis"'
  )
  .node(
    'keywordExtractor',
    'textContent:string -> keywords:string[] "Important keywords"'
  )

  // Execute nodes with proper input mapping
  .execute('summarizer', (state) => ({ documentText: state.documentText }))
  .execute('sentimentAnalyzer', (state) => ({
    textContent: state.documentText,
  }))
  .execute('keywordExtractor', (state) => ({
    textContent: state.summarizerResult.summaryText,
  }))

  // Use mapOutput() for the final transformation that shapes the output type
  // Note: Node results are typed as AxFieldValue, so we need to cast to specific types
  .mapOutput((state) => ({
    analysis: {
      summary: state.summarizerResult.summaryText as string,
      sentiment: state.sentimentAnalyzerResult.sentiment as string,
      keywords: state.keywordExtractorResult.keywords as string[],
      metadata: {
        originalLength: state.documentText.length,
        summaryLength: (state.summarizerResult.summaryText as string).length,
        compressionRatio:
          (state.summarizerResult.summaryText as string).length /
          state.documentText.length,
      },
    },
  }));

// Execute the workflow
const result = await documentAnalyzer.forward(llm, {
  documentText: `Artificial Intelligence is transforming our world in remarkable ways. 
    From healthcare to transportation, AI systems are becoming increasingly sophisticated 
    and capable. However, we must also consider the ethical implications and ensure 
    responsible development of these powerful technologies.`,
});

// TypeScript knows the exact type of result.analysis - no type assertion needed!
console.log('Analysis Results:');
console.log('Summary:', result.analysis.summary);
console.log('Sentiment:', result.analysis.sentiment);
console.log('Keywords:', result.analysis.keywords.join(', '));
console.log(
  'Compression Ratio:',
  `${(result.analysis.metadata.compressionRatio * 100).toFixed(1)}%`
);

// The type system provides full IntelliSense and type safety
// Try hovering over 'result.analysis' in your IDE to see the inferred type!

export { documentAnalyzer };
