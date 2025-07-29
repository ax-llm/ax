// Type inspection to see what's actually being inferred
import type { ParseSignature } from './sigtypes.js';

// Test simple signature
type Simple = ParseSignature<'userQuestion:string -> responseText:string'>;

// Test class signature 
type WithClass = ParseSignature<'input:string -> category:class "positive, negative, neutral"'>;

// Test array signature
type WithArray = ParseSignature<'items:string[] -> results:number[]'>;

// Test optional signature
type WithOptional = ParseSignature<'required:string, optional?:number -> result:string'>;

// Export for inspection - check these in your IDE's IntelliSense
export type TypeInspection = {
  Simple: Simple;
  SimpleInputs: Simple['inputs'];
  SimpleOutputs: Simple['outputs'];
  
  WithClass: WithClass;
  WithClassInputs: WithClass['inputs'];
  WithClassOutputs: WithClass['outputs'];
  
  WithArray: WithArray;
  WithArrayInputs: WithArray['inputs'];
  WithArrayOutputs: WithArray['outputs'];
  
  WithOptional: WithOptional;
  WithOptionalInputs: WithOptional['inputs'];
  WithOptionalOutputs: WithOptional['outputs'];
};

console.log('Type inspection complete - check TypeInspection in your IDE');