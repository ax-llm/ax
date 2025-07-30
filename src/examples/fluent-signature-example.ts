import { f } from '../ax/index.js';

// Example usage of the fluent signature API
const sig = f()
  .input(
    'contextData',
    f.string('The factual content to base the answer on.').optional().array()
  )
  .input(
    'questionText',
    f.string('The question to be answered.'),
    true // prepend adds 'questionText' to the top of the input fields
  )
  .output(
    'answerText',
    f.string('A concise answer to the question, typically 1-5 words.')
  )
  .output(
    'reasonText',
    f.string('thought behind the answer'),
    true // prepend adds 'reasonText' to the top of the output fields
  )
  .description('Answers questions based on the provided context.')
  .build();

console.log('=== Fluent Signature API Example ===');
console.log('Generated signature:', sig.toString());
console.log('\nInput fields:');
sig.getInputFields().forEach((field, index) => {
  console.log(
    `  ${index + 1}. ${field.name}: ${field.type?.name}${field.type?.isArray ? '[]' : ''}${field.isOptional ? ' (optional)' : ''}`
  );
  if (field.description) {
    console.log(`     Description: ${field.description}`);
  }
});

console.log('\nOutput fields:');
sig.getOutputFields().forEach((field, index) => {
  console.log(
    `  ${index + 1}. ${field.name}: ${field.type?.name}${field.type?.isArray ? '[]' : ''}`
  );
  if (field.description) {
    console.log(`     Description: ${field.description}`);
  }
});

console.log('\nDescription:', sig.getDescription());

// Example with various field types
const complexSig = f()
  .input('userMessage', f.string('User input message'))
  .input('imageData', f.image('Optional image').optional())
  .input('metadata', f.json('Additional metadata').optional())
  .output('responseText', f.string('Generated response'))
  .output(
    'sentimentType',
    f.class(['positive', 'negative', 'neutral'], 'Sentiment analysis')
  )
  .output('confidenceScore', f.number('Confidence score 0-1'))
  .output('keywordList', f.string('Extracted keywords').array())
  .description('Analyzes user messages and extracts insights')
  .build();

console.log('\n=== Complex Signature Example ===');
console.log('Generated signature:', complexSig.toString());
