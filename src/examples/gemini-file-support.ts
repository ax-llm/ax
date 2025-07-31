#!/usr/bin/env tsx

/**
 * Example: Google Gemini File Support with gs:// URLs
 *
 * This example demonstrates how to use the Ax framework with Google Gemini
 * to process files using both inline base64 data and Google Cloud Storage gs:// URLs.
 */

import { ax, ai, AxAIGoogleGeminiModel } from '@ax-llm/ax';

// Export reusable generators for both file formats
export const documentAnalyzer = ax(`
  userQuery:string "Analysis request",
  documentFile:file "Document to analyze" -> 
  analysis:string "Document analysis results",
  keyPoints:string[] "Main points extracted"
`);

export const multiDocumentProcessor = ax(`
  analysisRequest:string "Processing requirements",
  documents:file[] "Documents to process" ->
  summary:string "Overall summary",
  documentSummaries:string[] "Individual document summaries"
`);

// Demo with inline base64 data (traditional approach)
console.log('=== File Support Demo: Base64 Data ===');

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
});

// Single file with base64 data
const base64Result = await documentAnalyzer.forward(llm, {
  userQuery: 'Analyze this document for key insights',
  documentFile: {
    mimeType: 'application/pdf',
    data: 'JVBERi0xLjQKJYCAxlVcREMJaT...', // Sample base64 data
  },
});

console.log('Base64 Analysis:', base64Result.analysis);
console.log('Key Points:', base64Result.keyPoints);

// Demo with Google Cloud Storage gs:// URLs (new capability)
console.log('\n=== File Support Demo: gs:// URLs ===');

const cloudResult = await documentAnalyzer.forward(llm, {
  userQuery: 'Analyze this cloud-stored document',
  documentFile: {
    mimeType: 'application/pdf',
    fileUri: 'gs://my-analysis-bucket/documents/report.pdf',
  },
});

console.log('Cloud Storage Analysis:', cloudResult.analysis);
console.log('Key Points:', cloudResult.keyPoints);

// Demo with mixed file formats
console.log('\n=== Mixed File Format Demo ===');

const mixedResult = await multiDocumentProcessor.forward(llm, {
  analysisRequest: 'Process these mixed format documents',
  documents: [
    {
      mimeType: 'application/pdf',
      data: 'JVBERi0xLjQKJYCAxlVcREMJaT...', // Base64 data
    },
    {
      mimeType: 'application/pdf',
      fileUri: 'gs://my-bucket/documents/cloud-doc.pdf', // gs:// URL
    },
    {
      mimeType: 'text/csv',
      fileUri: 'gs://my-bucket/data/dataset.csv', // Different file type
    },
  ],
});

console.log('Mixed Format Summary:', mixedResult.summary);
console.log('Document Summaries:', mixedResult.documentSummaries);

console.log('\n✅ File support examples completed successfully!');
