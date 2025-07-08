import { AxAI, AxJSInterpreter, ax, f } from '@ax-llm/ax';

// Example showing how to use result picker with function results from JS interpreter

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Create a generator that solves math problems using JavaScript code
const mathSolverGen = ax`
  problem:${f.string('A mathematical problem to solve')} ->
  approach:${f.string('The approach or algorithm used')},
  solution:${f.string('The final answer')}
`;

// Create multiple JS interpreter instances for different approaches
const jsInterpreter1 = new AxJSInterpreter();
const jsInterpreter2 = new AxJSInterpreter();

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
      console.log(`  Error: ${result.isError ? 'YES' : 'NO'}`);

      if (!result.isError) {
        // Parse the result to evaluate the quality
        try {
          const output = result.result;
          console.log(
            `  Output: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}`
          );

          // Score based on output quality
          let score = 0;

          // Successful execution gets base points
          score += 50;

          // Bonus for comprehensive output
          if (output.length > 50) score += 20;

          // Bonus for including numbers (likely calculations)
          if (/\d+/.test(output)) score += 15;

          // Bonus for clear result structure
          if (
            output.includes('=') ||
            output.includes('result') ||
            output.includes('answer')
          )
            score += 15;

          console.log(`  Quality Score: ${score}/100`);

          if (score > bestScore) {
            bestScore = score;
            bestIndex = result.index;
          }
        } catch (e) {
          console.log(`  Parse Error: ${e}`);
        }
      } else {
        console.log(`  Error Output: ${result.result}`);
      }
    }

    console.log(
      `\nSelected function result ${bestIndex} with score ${bestScore}`
    );
    return bestIndex;
  }
  // Handle field results - pick based on approach quality
  console.log('Evaluating field results:');

  for (const result of data.results) {
    console.log(
      `Option ${result.index}: ${result.sample.approach} -> ${result.sample.solution}`
    );
  }

  // Simple strategy: pick the first one
  console.log('Selected option 0 (first available)');
  return 0;
};

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
    functions: [jsInterpreter1, jsInterpreter2],
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
    functions: [jsInterpreter1, jsInterpreter2],
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
    functions: [jsInterpreter1, jsInterpreter2],
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
    functions: [jsInterpreter1, jsInterpreter2],
    resultPicker: functionResultPicker,
  }
);

console.log('\nSelected Result:');
console.log(`Approach: ${result4.approach}`);
console.log(`Solution: ${result4.solution}`);

console.log('\n=== Demo Complete ===');
