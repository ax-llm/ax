// Simple type test to see what's happening
import { ax } from './template.js';
import type { ParseSignature } from './sigtypes.js';

// Test the type parsing directly
type TestSig = ParseSignature<'userQuestion:string -> responseText:string'>;

// Create a generator
const gen = ax('userQuestion:string -> responseText:string');

// Check what types we actually get
type GenType = typeof gen;
type InputType = Parameters<typeof gen.forward>[1];
type OutputType = Awaited<ReturnType<typeof gen.forward>>;

// Log for inspection
console.log('Generator created successfully');
console.log('Signature:', gen.getSignature().toString());

// Export for type inspection in IDE
export type TypeTest = {
  TestSig: TestSig;
  GenType: GenType;
  InputType: InputType;
  OutputType: OutputType;
  // These should show the actual inferred types
  TestInputs: TestSig['inputs'];
  TestOutputs: TestSig['outputs'];
};
