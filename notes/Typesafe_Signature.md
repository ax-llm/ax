# **Task: Implement Dynamic Type Inference for AxSignature and AxGen**

This document outlines the necessary code changes to implement a robust, type-safe system for AxSignature and AxGen. The goal is to parse a signature string (e.g., 'question: string \-\> answer: string') at the type level, providing automatic type inference, autocompletion, and compile-time safety for all downstream methods.

## **Summary of Changes**

1. **Create a new file (**ax/src/types.ts**)**: This file will contain the advanced TypeScript types responsible for parsing signature strings, including support for optional fields (?) and array types (string\[\]).  
2. **Modify** ax/src/sig.ts: The AxSignature class will be made generic. A static factory method, create, will be added to enable the crucial compile-time type inference.  
3. **Modify** ax/src/generate.ts: The AxGen class will also be made generic to accept the new typed signature, ensuring its methods (forward, streamingForward) are fully type-safe.

## **Step 1: Create New Type-Helper File**

Create a new file at ax/src/types.ts. This file will contain all the utility types for parsing the signature string at compile time.

**File:** ax/src/types.ts

/\*\*  
 \* A map of string type names to their corresponding TypeScript types.  
 \* Extend this to support more types like 'boolean\[\]', 'number\[\]' etc.  
 \*/  
export interface TypeMap {  
  string: string;  
  number: number;  
  boolean: boolean;  
  'string\[\]': string\[\];  
  'number\[\]': number\[\];  
  'boolean\[\]': boolean\[\];  
}

// Helper to trim whitespace from a type string  
type Trim\<S extends string\> \= S extends \` ${infer T}\` | \`${infer T} \` ? Trim\<T\> : S;

// Parses a single field, checking for the optional marker "?" at the end of the name  
type ParseField\<S extends string\> \= S extends \`${infer Name}?:\`  
  ? { name: Trim\<Name\>; optional: true }  
  : { name: Trim\<S\>; optional: false };

// Parses a "name: type" or "name?: type" part, now handling arrays  
type ParseNameAndType\<S extends string\> \= S extends \`${infer Name}:${infer Type}\`  
  ? ParseField\<Name\> & { type: Trim\<Type\> }  
  : never;

// Recursively parses a comma-separated list of fields into a tuple of field objects  
type ParseFields\<S extends string\> \= S extends \`${infer Field},${infer Rest}\`  
  ? \[ParseNameAndType\<Trim\<Field\>\>, ...ParseFields\<Trim\<Rest\>\>\]  
  : \[ParseNameAndType\<Trim\<S\>\>\];

/\*\*  
 \* Builds a TypeScript object type from a readonly tuple of field definitions,  
 \* supporting both required and optional fields.  
 \*/  
export type BuildObject\<  
  T extends readonly { name: string; type: keyof TypeMap; optional: boolean }\[\]  
\> \= {  
  // Map required properties  
  \-readonly \[K in T\[number\] as K\['optional'\] extends false ? K\['name'\] : never\]: TypeMap\[K\['type'\]\];  
} & {  
  // Map optional properties  
  \-readonly \[K in T\[number\] as K\['optional'\] extends true ? K\['name'\] : never\]?: TypeMap\[K\['type'\]\];  
};

/\*\*  
 \* The main signature parser.  
 \* It splits the signature string "inputs \-\> outputs" and builds the final input/output types.  
 \*/  
export type ParseSignature\<S extends string\> \= S extends \`${infer Inputs} \-\> ${infer Outputs}\`  
  ? {  
      inputs: BuildObject\<ParseFields\<Trim\<Inputs\>\>\>;  
      outputs: BuildObject\<ParseFields\<Trim\<Outputs\>\>\>;  
    }  
  : { inputs: Record\<string, any\>, outputs: Record\<string, any\> }; // Fallback for invalid format

## **Step 2: Modify** AxSignature **Class**

Update the ax/src/sig.ts file to make the class generic and add the static create factory method. This method is **essential** for capturing the literal string type and enabling inference.

**File:** ax/src/sig.ts

import { ParseSignature } from './types'; // 1\. IMPORT the new types

export interface DSPyField {  
  name: string;  
  desc?: string;  
  typeName?: string;  
}

// 2\. MAKE the class generic  
export class AxSignature\<  
  TInput extends Record\<string, any\> \= Record\<string, any\>,  
  TOutput extends Record\<string, any\> \= Record\<string, any\>  
\> {  
  private readonly signature: string;  
  private inputs: DSPyField\[\] \= \[\];  
  private outputs: DSPyField\[\] \= \[\];  
  private instructions: string \= '';

  // The runtime constructor logic does not need to change.  
  public constructor(signature: string) {  
    this.signature \= signature;  
    const parts \= signature.split('-\>');  
    if (parts.length \< 2\) {  
      throw new Error('Invalid signature format. Expected "input \-\> output".');  
    }

    const parseFields \= (fieldsStr: string): DSPyField\[\] \=\> {  
      return fieldsStr.split(',').map((field) \=\> {  
        const \[name, typeName\] \= field.trim().split(':').map(s \=\> s.trim());  
        return { name, typeName };  
      });  
    };

    this.inputs \= parseFields(parts\[0\]);  
    this.outputs \= parseFields(parts\[1\]);  
  }

  // 3\. ADD the static factory method for type inference  
  public static create\<const T extends string\>(  
    signature: T  
  ): AxSignature\<ParseSignature\<T\>\['inputs'\], ParseSignature\<T\>\['outputs'\]\> {  
    return new AxSignature(signature);  
  }

  // The rest of the methods remain unchanged  
  public getInputs \= (): DSPyField\[\] \=\> this.inputs;  
  public getOutputs \= (): DSPyField\[\] \=\> this.outputs;  
  public getOutputJSONSchema \= (): Record\<string, any\> \=\> {  
    const properties \= this.outputs.reduce(  
      (acc, { name, typeName, desc }) \=\> {  
        acc\[name\] \= { type: typeName || 'string', description: desc || '' };  
        return acc;  
      },  
      {} as Record\<string, any\>  
    );  
    return { type: 'object', properties };  
  };  
}

## **Step 3: Modify** AxGen **Class**

Update ax/src/generate.ts to make AxGen generic. This allows it to inherit the types from the AxSignature instance, providing type safety for its methods.

**File:** ax/src/generate.ts

import { AxAI } from './ai';  
import { AxSignature } from './sig';  
import { AxChainOfThought } from './cot';

// 1\. MAKE the class generic  
export class AxGen\<  
  TInput extends Record\<string, any\>,  
  TOutput extends Record\<string, any\>  
\> {  
  private sig: AxSignature\<TInput, TOutput\>;  
  private lm: AxAI;

  // 2\. UPDATE the constructor to accept the generic AxSignature  
  constructor(languageModel: AxAI, signature: AxSignature\<TInput, TOutput\>) {  
    this.sig \= signature;  
    this.lm \= languageModel;  
  }

  // 3\. UPDATE the 'forward' method to use the inferred generic types  
  public async forward(values: TInput): Promise\<TOutput\> {  
    const prompt \= this.createPrompt(values);  
    const result \= await this.lm.forward(prompt, {  
      json\_schema: this.sig.getOutputJSONSchema(),  
    });  
    return JSON.parse(result) as TOutput;  
  }

  // 4\. UPDATE the 'streamingForward' method to use the inferred types  
  public async streamingForward(  
    values: TInput,  
    onUpdate: (data: Partial\<TOutput\>) \=\> void  
  ): Promise\<TOutput\> {  
    const prompt \= this.createPrompt(values);  
    let currentData \= '';

    const stream \= this.lm.stream(prompt);

    for await (const chunk of stream) {  
      currentData \+= chunk;  
      try {  
        onUpdate(JSON.parse(currentData) as Partial\<TOutput\>);  
      } catch (e) {  
        // Ignore parsing errors for incomplete JSON  
      }  
    }  
    return JSON.parse(currentData) as TOutput;  
  }

  private createPrompt(values: TInput): string {  
    const inputFields \= this.sig.getInputs().map(field \=\> \`${field.name}: ${values\[field.name\]}\`).join('\\n');  
    const outputFields \= this.sig.getOutputs().map(field \=\> \`${field.name}:\`).join('\\n');  
    return \`${inputFields}\\n${outputFields}\`;  
  }  
}

## **Step 4: Example Usage**

This section demonstrates how to use the newly implemented system. The AxSignature.create method is now the entry point for creating typed signature instances.

import { AxAI } from './ai';  
import { AxSignature } from './sig';  
import { AxGen } from './generate';  
// import { ax } from './ax'; // This works with tagged template literals too

// Assume a configured AI model  
const myAI \= new AxAI({ /\* ... \*/ });

// Use the new static \`create\` method.  
// It supports multiline strings, tagged template literals (\`ax\`, \`s\`, etc.),  
// optional fields (name?: type), and array types (string\[\]).  
const mySignature \= AxSignature.create(  
  'question: string, context?: string\[\] \-\> answer: string, citations: number\[\]'  
);

// The \`mySignature\` instance is now strongly typed:  
// AxSignature\<  
//   { question: string; context?: string\[\] },  
//   { answer: string; citations: number\[\] }  
// \>

// Instantiate AxGen with the typed signature  
const myGenerator \= new AxGen(myAI, mySignature);

// The \`forward\` method is now fully type-safe, providing autocompletion and error checking.  
async function run() {  
  const result \= await myGenerator.forward({  
    question: "What is the capital of Canada?",  
    // The 'context' field is optional and can be omitted or provided.  
    context: \["Canada is a country...", "The capital is Ottawa."\]  
  });

  // The \`result\` object is also fully typed.  
  console.log(result.answer);      // (property) answer: string  
  console.log(result.citations);   // (property) citations: number\[\]

  // A typo like \`questin\` or providing a number for \`question\` would cause a compile-time error.  
}  
