// Debug what's happening with BuildObject types
import { ax } from './template.js';
import type { ParseSignature, BuildObject } from './sigtypes.js';

// Test direct ParseSignature usage
type TestParse = ParseSignature<'userQuestion:string -> responseText:string'>;

// Check what we get for inputs and outputs
type TestInputs = TestParse['inputs'];
type TestOutputs = TestParse['outputs'];

// Test BuildObject directly
type TestBuildInputs = BuildObject<[{ name: 'userQuestion'; type: 'string'; optional: false }]>;
type TestBuildOutputs = BuildObject<[{ name: 'responseText'; type: 'string'; optional: false }]>;

// Create actual generator
const gen = ax('userQuestion:string -> responseText:string');

// Check the generator's types
type GenInputs = Parameters<typeof gen.forward>[1];
type GenOutputs = Awaited<ReturnType<typeof gen.forward>>;

// Export types for inspection
export type DebugTypes = {
  TestParse: TestParse;
  TestInputs: TestInputs;
  TestOutputs: TestOutputs;
  TestBuildInputs: TestBuildInputs;
  TestBuildOutputs: TestBuildOutputs;
  GenInputs: GenInputs;
  GenOutputs: GenOutputs;
};

// Show the runtime signature for verification
console.log('Signature created:', gen.getSignature().toString());
console.log('Check the exported DebugTypes in your IDE!');

// Test a more complex signature
const complexGen = ax('userQuestion:string, contextData:json -> responseText:string, confidenceScore:number');
console.log('Complex signature:', complexGen.getSignature().toString());