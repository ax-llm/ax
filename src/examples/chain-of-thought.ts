import { AxAI, AxAIGoogleGeminiModel, AxFlow, f } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

console.log('=== Chain of Thought Examples ===');

// Example 1: AxFlow with reasoning field added
const mathSolver = new AxFlow<
  { mathProblem: string },
  { reasoning: string; solution: string }
>()
  .node(
    'solver',
    'mathProblem:string -> reasoning:string "Step-by-step reasoning", solution:string "Final answer"'
  )
  .execute('solver', (state) => ({
    mathProblem: state.mathProblem,
  }))
  .map((state) => ({
    reasoning: state.solverResult.reasoning,
    solution: state.solverResult.solution,
  }));

const mathResult = await mathSolver.forward(ai, {
  mathProblem:
    'If a train travels 120 miles in 2 hours, what is its average speed in miles per hour?',
});

console.log('Math Problem Solution:');
console.log('Reasoning:', mathResult.reasoning);
console.log('Solution:', mathResult.solution);

console.log('\n=== Advanced AxFlow with Conditional Reasoning ===');

// Example 2: AxFlow with conditional reasoning visibility
const conditionalReasoner = new AxFlow<
  { question: string; showReasoning: boolean },
  { answer: string; reasoning?: string }
>()
  .branch((state) => state.showReasoning)
  .when(true)
  .node(
    'reasoningAnswerer',
    'question:string -> reasoning:string "Detailed step-by-step reasoning", answer:string'
  )
  .execute('reasoningAnswerer', (state) => ({
    question: state.question,
  }))
  .map((state) => ({
    answer: state.reasoningAnswererResult.answer,
    reasoning: state.reasoningAnswererResult.reasoning,
  }))
  .when(false)
  .node('simpleAnswerer', 'question:string -> answer:string')
  .execute('simpleAnswerer', (state) => ({
    question: state.question,
  }))
  .map((state) => ({
    answer: state.simpleAnswererResult.answer,
  }))
  .merge();

// With reasoning
const reasoningResult = await conditionalReasoner.forward(ai, {
  question: 'Why do leaves change color in autumn?',
  showReasoning: true,
});

console.log('With Reasoning:');
console.log('Answer:', reasoningResult.answer);
console.log('Reasoning:', reasoningResult.reasoning);

// Without reasoning
const simpleResult = await conditionalReasoner.forward(ai, {
  question: 'Why do leaves change color in autumn?',
  showReasoning: false,
});

console.log('\nWithout Reasoning:');
console.log('Answer:', simpleResult.answer);
console.log('Reasoning:', simpleResult.reasoning); // undefined

export { mathSolver, conditionalReasoner };
