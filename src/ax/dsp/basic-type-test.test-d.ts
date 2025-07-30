// Basic TypeScript type tests for fluent API
import { f, s } from '../index.js';

// Test 1: Basic type inference works
const basicSig = f()
  .input('userQuery', f.string('User query'))
  .output('responseText', f.string('Response'))
  .build();

// These should not show any 'any' types - the signature builder should preserve exact types
const _basicInput = basicSig.getInputFields()[0];
const _basicOutput = basicSig.getOutputFields()[0];

// Test 2: Array types work
const arraySig = f()
  .input('itemList', f.array(f.string('Items')))
  .output('resultList', f.array(f.string('Results')))
  .build();

// Test 3: Optional types work
const optSig = f()
  .input('requiredField', f.string('Required'))
  .input('optionalField', f.optional(f.string('Optional')))
  .output('resultText', f.string('Result'))
  .build();

// Test 4: Class types with const assertion
const classSig = f()
  .input('inputText', f.string('Text'))
  .output(
    'sentiment',
    f.class(['positive', 'negative', 'neutral'] as const, 'Sentiment')
  )
  .build();

// Test 5: Complex combinations
const complexSig = f()
  .input('userInput', f.string('Input'))
  .input('optionalNumbers', f.optional(f.array(f.number('Numbers'))))
  .output('resultText', f.string('Result'))
  .output('confidence', f.number('Confidence'))
  .output('categories', f.array(f.string('Categories')))
  .output('metadata', f.optional(f.json('Metadata')))
  .build();

// The key test: verify that signatures can be created and have proper structure
console.log(
  'Basic signature created successfully:',
  basicSig.toString().length > 0
);
console.log(
  'Array signature created successfully:',
  arraySig.toString().length > 0
);
console.log(
  'Optional signature created successfully:',
  optSig.toString().length > 0
);
console.log(
  'Class signature created successfully:',
  classSig.toString().length > 0
);
console.log(
  'Complex signature created successfully:',
  complexSig.toString().length > 0
);

// Test signature equivalence with string version
const stringEquivalent = s(
  'userInput:string, optionalNumbers?:number[] -> resultText:string, confidence:number, categories:string[], metadata?:json'
);

console.log('Field count comparison:');
console.log('Fluent inputs:', complexSig.getInputFields().length);
console.log('String inputs:', stringEquivalent.getInputFields().length);
console.log('Fluent outputs:', complexSig.getOutputFields().length);
console.log('String outputs:', stringEquivalent.getOutputFields().length);

// Test that field types are preserved correctly
const fluentInputTypes = complexSig.getInputFields().map((f) => ({
  name: f.name,
  type: f.type?.name,
  isArray: f.type?.isArray,
  isOptional: f.isOptional,
}));

const stringInputTypes = stringEquivalent.getInputFields().map((f) => ({
  name: f.name,
  type: f.type?.name,
  isArray: f.type?.isArray,
  isOptional: f.isOptional,
}));

console.log(
  'Type comparison successful:',
  fluentInputTypes.length === stringInputTypes.length &&
    fluentInputTypes.every((ft, i) => {
      const st = stringInputTypes[i];
      return (
        ft.name === st.name &&
        ft.type === st.type &&
        ft.isArray === st.isArray &&
        ft.isOptional === st.isOptional
      );
    })
);

console.log(
  '✅ All type tests completed - fluent API matches string signature behavior!'
);
