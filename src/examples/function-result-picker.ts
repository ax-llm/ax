import { AxAI, AxJSInterpreter, ax } from '@ax-llm/ax';

// Example showing how to use result picker with function results from JS interpreter

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Create a generator that solves math problems using JavaScript code
const mathSolverGen = ax(
  'problem:string "A mathematical problem to solve" -> approach:string "The approach or algorithm used", solution:string "The final answer"'
);

// Create multiple JS interpreter instances for different approaches
const jsInterpreter1 = new AxJSInterpreter();

// Result picker that evaluates function execution results
const functionResultPicker = async (
  data:
    | {
        type: 'fields';
        results: readonly {
          index: number;
          sample: Partial<{ approach: string; solution: string }>;
        }[];
      }
    | {
        type: 'function';
        results: readonly {
          index: number;
          functionName: string;
          functionId: string;
          args: string | object;
          result: string;
          isError?: boolean;
        }[];
      }
) => {
  console.log('\n=== Function Result Evaluation ===');

  if (data.type === 'function') {
    console.log('Evaluating function execution results:');

    let bestIndex = 0;
    let bestScore = -1;

    for (const result of data.results) {
      console.log(`\nFunction ${result.index}:`);
      console.log(`  Name: ${result.functionName}`);
      console.log(`  Args: ${JSON.stringify(result.args, null, 2)}`);
      console.log(`  Error: ${result.isError ? 'Yes' : 'No'}`);
      console.log(`  Result length: ${result.result.length}`);

      // Simple scoring: prefer non-error results with longer, more detailed output
      let score = result.isError ? 0 : 1;
      if (!result.isError) {
        score += Math.min(result.result.length / 100, 5); // Bonus for detailed results
      }

      console.log(`  Score: ${score}`);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = result.index;
      }
    }

    console.log(
      `\nSelected function result ${bestIndex} with score ${bestScore}`
    );
    return bestIndex;
  }

  // For field results, just pick the first one
  console.log('Field results evaluation - selecting first available');
  if (data.results.length > 0) {
    console.log(`Selected sample ${data.results[0].index}`);
    return data.results[0].index;
  }

  console.log('No results available, selecting default');
  return 0;
};

// Simple result picker for when no complex evaluation is needed
// const simpleResultPicker = async () => {
//   console.log('Selected option 0 (first available)');
//   return 0;
// };

// Test 1: Prime number generation with different approaches
console.log('=== Test 1: Prime Number Generation ===');

const result1 = await mathSolverGen.forward(
  ai,
  {
    problem:
      'Generate the first 10 prime numbers using the Sieve of Eratosthenes algorithm. Show your work step by step.',
  },
  {
    sampleCount: 2,
    functions: [jsInterpreter1],
    resultPicker: functionResultPicker,
  }
);

console.log('\nSelected Result:');
console.log(`Approach: ${result1.approach}`);
console.log(`Solution: ${result1.solution}`);

// Test 2: Factorial calculation with performance comparison
console.log('\n\n=== Test 2: Factorial Calculation ===');

const result2 = await mathSolverGen.forward(
  ai,
  {
    problem:
      'Calculate 15! (15 factorial) using both recursive and iterative approaches. Compare their performance and show the timing.',
  },
  {
    sampleCount: 2,
    functions: [jsInterpreter1],
    resultPicker: functionResultPicker,
  }
);

console.log('\nSelected Result:');
console.log(`Approach: ${result2.approach}`);
console.log(`Solution: ${result2.solution}`);

// Test 3: Complex data analysis
console.log('\n\n=== Test 3: Statistical Analysis ===');

const result3 = await mathSolverGen.forward(
  ai,
  {
    problem:
      'Given the array [1, 5, 3, 9, 2, 8, 4, 7, 6], calculate mean, median, mode, standard deviation, and create a frequency distribution. Format the results nicely.',
  },
  {
    sampleCount: 3,
    functions: [jsInterpreter1],
    resultPicker: functionResultPicker,
  }
);

console.log('\nSelected Result:');
console.log(`Approach: ${result3.approach}`);
console.log(`Solution: ${result3.solution}`);

// Test 4: Algorithm comparison
console.log('\n\n=== Test 4: Sorting Algorithm Comparison ===');

const result4 = await mathSolverGen.forward(
  ai,
  {
    problem:
      'Sort the array [64, 34, 25, 12, 22, 11, 90] using at least two different sorting algorithms (like bubble sort and quick sort). Compare their step counts and show the process.',
  },
  {
    sampleCount: 2,
    functions: [jsInterpreter1],
    resultPicker: functionResultPicker,
  }
);

console.log('\nSelected Result:');
console.log(`Approach: ${result4.approach}`);
console.log(`Solution: ${result4.solution}`);

console.log('\n=== Demo Complete ===');
