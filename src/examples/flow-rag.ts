import { AxFlow, AxFlowNode } from '../ax/flow/flow';
import { AxGen } from '../ax/dsp/generate';
import { AxSignature } from '../ax/dsp/sig';
import type { AxGenIn, AxGenOut, AxProgramForwardOptions } from '../ax/dsp/program';
import type { AxAIService } from '../ax/ai/types';
import { AxOpenAI } from '../ax/ai/openai'; // Using OpenAI for a concrete AI service

// Define a mock AI service for testing if needed, or use a real one with proper setup
// For this example, let's assume AxOpenAI can be instantiated (might require API keys)
// If not, a simpler mock would be needed.
const ai = new AxOpenAI({ apiKey: process.env.OPENAI_API_KEY || "your-api-key" });

// --- Define Interfaces for our RAG flow ---
interface RAGInput extends AxGenIn {
  question: string;
}

interface RAGOutput extends AxGenOut {
  answer: string;
  finalContext: string[];
}

interface RAGState extends AxGenIn {
  question: string;
  context: string[];
  hop: number;
  maxHops: number;
  query?: string;
  retrievedDocs?: string[];
  quality?: { needsMoreInfo: boolean; confidence: number };
  nodes?: Record<string, AxFlowNode<any, any>>; // AxFlow adds this
}

// --- Mock Implementations for Retrieve and QualityCheck ---

// Mock Retrieve Node
class MockRetrieveNode implements AxFlowNode<{ query: string }, { documents: string[] }> {
  async execute(
    _ai: Readonly<AxAIService>,
    values: { query: string },
    _options?: Readonly<AxProgramForwardOptions>
  ): Promise<{ documents: string[] }> {
    console.log(`MockRetrieveNode: Retrieving documents for query: "${values.query}"`);
    // Simulate document retrieval
    return { documents: [`Document related to "${values.query}" - Content snippet 1`, `Another doc for "${values.query}"`] };
  }
  getSignature() {
    return new AxSignature("query:string -> documents:string[]");
  }
}

// Mock QualityCheck Node
class MockQualityCheckNode implements AxFlowNode<{ documents: string[]; question: string }, { needsMoreInfo: boolean; confidence: number }> {
  async execute(
    _ai: Readonly<AxAIService>,
    values: { documents: string[]; question: string },
    _options?: Readonly<AxProgramForwardOptions>
  ): Promise<{ needsMoreInfo: boolean; confidence: number }> {
    console.log(`MockQualityCheckNode: Checking quality for question: "${values.question}" with ${values.documents.length} documents.`);
    // Simulate quality check
    const confidence = Math.random(); // Random confidence
    const needsMoreInfo = confidence < 0.7; // Arbitrary threshold
    return { needsMoreInfo, confidence };
  }
  getSignature() {
    return new AxSignature("documents:string[], question:string -> needsMoreInfo:boolean, confidence:number");
  }
}

// --- Create the RAG Flow ---

const ragFlow = new AxFlow<RAGInput, RAGOutput, RAGState>();

// 1. Define Nodes
ragFlow
  .node('queryGen', new AxGen(new AxSignature(
    '"Generate a search query based on the question and existing context." context?:string[], question:string -> query:string'
  )))
  .node('retrieve', new MockRetrieveNode())
  .node('qualityCheck', new MockQualityCheckNode())
  .node('answerGen', new AxGen(new AxSignature(
    '"Answer the question based on the provided context." context:string[], question:string -> answer:string'
  )));

// 2. Define Flow Logic
ragFlow
  .input(
    'question:string', // Input signature for the whole flow
    (input: RAGInput): RAGState => ({ // Initial state factory
      question: input.question,
      context: [],
      hop: 0,
      maxHops: 3
    })
  )
  .while(
    (state) => state.hop < state.maxHops && (state.quality?.needsMoreInfo !== false) // Loop while hops are left AND quality check doesn't say "good enough" (or quality check hasn't run)
  )
    // Execute query generation
    .addExecuteStep(
      'queryGen',
      (state) => ({ question: state.question, context: state.context }), // Input mapper for queryGen
      (state, output) => { state.query = output.query; } // Output accumulator
    )
    // Execute retrieval
    .addExecuteStep(
      'retrieve',
      (state) => ({ query: state.query! }),
      (state, output) => { state.retrievedDocs = output.documents; }
    )
    // Accumulate context (using a map operation for this)
    .addMapStep((state) => {
      if (state.retrievedDocs) {
        // Simple de-duplication
        const newDocs = state.retrievedDocs.filter(doc => !state.context.includes(doc));
        state.context.push(...newDocs);
      }
      return state; // Or modify in place and return void
    })
    // Execute quality check
    .addExecuteStep(
      'qualityCheck',
      (state) => ({ documents: state.context, question: state.question }),
      (state, output) => { state.quality = output; }
    )
    // Increment hop counter (using a map operation)
    .addMapStep((state) => {
      state.hop++;
      console.log(`Hop: ${state.hop}, Confidence: ${state.quality?.confidence}, NeedsMoreInfo: ${state.quality?.needsMoreInfo}`);
      // Early exit from loop if confidence is high (alternative to breakIf, by influencing while condition)
      if (state.quality && state.quality.confidence > 0.9) {
         // This is a way to break: ensure the while condition `state.quality?.needsMoreInfo !== false` becomes false
         state.quality.needsMoreInfo = false;
      }
      return state;
    })
  // .endWhile() // Conceptual: AxFlow's `while` returns an object to chain methods for the loop body.
  // The end of chaining on that object implicitly means end of while block.

  // After loop, generate final answer
  .execute(
    'answerGen',
    (state) => ({ question: state.question, context: state.context }),
    (state, output) => { (state as RAGState & { finalAnswer?: string }).finalAnswer = output.answer; } // Store answer in state
  )
  // Define the final output of the flow
  .output(
    'answer:string, finalContext:string[]', // Output signature for the whole flow
    (state) => ({
      answer: (state as RAGState & { finalAnswer?: string }).finalAnswer || "No answer generated.",
      finalContext: state.context
    })
  );

// --- Execute the Flow ---
async function main() {
  console.log('Starting RAG Flow...');
  try {
    const result = await ragFlow.forward(ai, { question: "What is the capital of France and explain its significance?" });
    console.log('\n--- RAG Flow Result ---');
    console.log('Answer:', result.answer);
    console.log('Final Context:', result.finalContext);
    console.log('Usage:', ragFlow.getUsage());

  } catch (error) {
    console.error('Error during RAG flow execution:', error);
  }
}

main();

// To run this example:
// 1. Make sure you have @ax/ax installed and dependencies.
// 2. Set OPENAI_API_KEY environment variable if you are using the real AxOpenAI.
//    Otherwise, you'll need to mock AxAIService more thoroughly or ensure AxOpenAI can run in a dummy mode.
// 3. Execute with `ts-node src/examples/flow-rag.ts` (ensure ts-node is installed).
//
// Note: This example uses AxOpenAI. If it requires an API key for instantiation even for non-execution paths,
// and you don't provide one, it might fail at `const ai = new AxOpenAI(...)`.
// A more robust mock for AxAIService would be:
/*
const mockAI: Readonly<AxAIService> = {
  getName: () => 'mockAI',
  getModelConfig: () => ({}),
  getOptions: () => ({}),
  chat: async (req, options) => {
    // Simulate AI responses for AxGen nodes
    if (req.messages[req.messages.length-1]?.content?.includes('search query')) {
      return { choices: [{ message: { content: JSON.stringify({ query: `search for ${req.messages[0].values.question}`}) } }] };
    }
    if (req.messages[req.messages.length-1]?.content?.includes('Answer the question')) {
      return { choices: [{ message: { content: JSON.stringify({ answer: `Mocked answer to ${req.messages[0].values.question}`}) } }] };
    }
    return { choices: [{ message: { content: '{}' } }] };
  },
  embed: async (req, options) => ({ embeddings: [[0.1, 0.2]] }),
  setOptions: (options) => {},
  setModelConfig: (config) => {},
  clone: (options) => mockAI
};
// Then use `mockAI` instead of `ai` in `ragFlow.forward(mockAI, ...)`
*/
