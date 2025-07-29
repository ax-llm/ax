/**
 * Teacher-Student Optimization with MiPRO and Python Optimizer
 *
 * This example demonstrates using a large teacher model (Gemini Pro) to optimize
 * a small student model (SmolLM:360m) for complex algorithm implementation tasks.
 * The small model initially struggles with complex coding tasks, but through MiPRO
 * optimization guided by the teacher model, it learns to perform much better.
 */

import { AxAI, AxMiPRO, ax, AxAIGoogleGeminiModel } from '../ax/index.js';

// Environment checks
const requiredEnvVars = ['GOOGLE_APIKEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ ${envVar} environment variable is required`);
    process.exit(1);
  }
}

// Teacher model: Gemini Pro (large, capable model)
const teacherAI = new AxAI({
  name: 'google-gemini' as const,
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini15Flash },
});

// Student model: SmolLM:360m on Ollama (small, limited model)
const studentAI = new AxAI({
  name: 'ollama' as const,
  apiKey: '',
  config: {
    model: 'smollm:360m',
  },
});

// Define the complex task: Algorithm Implementation
// This requires understanding algorithms, edge cases, and Python syntax
const algorithmImplementer = ax(
  'algorithmName:string "Name of the algorithm to implement" -> implementation:code "python" "Complete Python function implementation", explanation:string "Brief explanation of how the algorithm works", timeComplexity:string "Time complexity in Big O notation"'
);

// Training examples: Complex algorithms that require sophisticated understanding
const algorithmTasks = [
  {
    algorithmName: 'Binary Search with duplicate handling',
    expectedImplementation: `def binary_search_leftmost(arr, target):
    left, right = 0, len(arr)
    while left < right:
        mid = (left + right) // 2
        if arr[mid] < target:
            left = mid + 1
        else:
            right = mid
    return left if left < len(arr) and arr[left] == target else -1`,
    expectedComplexity: 'O(log n)',
  },
  {
    algorithmName: 'Merge two sorted arrays in-place',
    expectedImplementation: `def merge_sorted_arrays(arr1, m, arr2, n):
    i, j, k = m - 1, n - 1, m + n - 1
    while i >= 0 and j >= 0:
        if arr1[i] > arr2[j]:
            arr1[k] = arr1[i]
            i -= 1
        else:
            arr1[k] = arr2[j]
            j -= 1
        k -= 1
    while j >= 0:
        arr1[k] = arr2[j]
        j -= 1
        k -= 1`,
    expectedComplexity: 'O(m + n)',
  },
  {
    algorithmName: 'Find longest palindromic substring',
    expectedImplementation: `def longest_palindrome(s):
    if not s:
        return ""
    start, max_len = 0, 1
    for i in range(len(s)):
        # Check odd length palindromes
        left, right = i, i
        while left >= 0 and right < len(s) and s[left] == s[right]:
            if right - left + 1 > max_len:
                start, max_len = left, right - left + 1
            left -= 1
            right += 1
        # Check even length palindromes
        left, right = i, i + 1
        while left >= 0 and right < len(s) and s[left] == s[right]:
            if right - left + 1 > max_len:
                start, max_len = left, right - left + 1
            left -= 1
            right += 1
    return s[start:start + max_len]`,
    expectedComplexity: 'O(n²)',
  },
];

// Evaluation metric: How well does the implementation work?
const implementationQuality = async ({
  prediction,
  example,
}: {
  prediction: any;
  example: any;
}) => {
  let score = 0;

  // Check if implementation contains key algorithmic concepts
  const impl = prediction.implementation.toLowerCase();

  // Basic structure checks
  if (impl.includes('def ') && impl.includes('return')) score += 0.2;
  if (impl.includes('while') || impl.includes('for')) score += 0.2;

  // Algorithm-specific checks
  if (example.algorithmName.includes('binary search') && impl.includes('mid'))
    score += 0.3;
  if (example.algorithmName.includes('merge') && impl.includes('while'))
    score += 0.3;
  if (
    example.algorithmName.includes('palindrome') &&
    impl.includes('left') &&
    impl.includes('right')
  )
    score += 0.3;

  // Quality indicators
  if (prediction.explanation && prediction.explanation.length > 20)
    score += 0.2;
  if (prediction.timeComplexity?.includes('O(')) score += 0.1;

  return Math.min(score, 1.0);
};

console.log('🎓 Teacher-Student Algorithm Implementation Optimization');
console.log('====================================================');

async function demonstrateTeacherStudentOptimization() {
  // First, test the student model before optimization
  console.log('\n📝 Testing student model BEFORE optimization:');

  const testTask = algorithmTasks[0];
  try {
    const beforeResult = await algorithmImplementer.forward(studentAI, {
      algorithmName: testTask.algorithmName,
    });
    const result = beforeResult.answer as {
      implementation: string;
      explanation: string;
      timeComplexity: string;
    };
    console.log(
      `📊 Before - Implementation quality: ${(
        await implementationQuality({
          prediction: result,
          example: testTask,
        })
      ).toFixed(2)}`
    );
  } catch (_error) {
    console.log('❌ Student model failed before optimization');
  }

  // Run MiPRO optimization with teacher model guidance
  console.log('\n🔧 Running MiPRO optimization with teacher model...');

  const optimizer = new AxMiPRO({
    studentAI, // Small model to optimize
    teacherAI, // Large model to guide optimization
    examples: algorithmTasks,

    // Python optimizer integration
    optimizerEndpoint:
      process.env.PYTHON_OPTIMIZER_ENDPOINT || 'http://localhost:8000',
    optimizerTimeout: 60000, // 60 seconds timeout
    optimizerRetries: 3, // 3 retry attempts

    // MiPRO settings (all at top level now)
    numTrials: 15,
    verbose: true, // Enable verbose logging
    minibatch: true,
    minibatchSize: 2,

    // Teacher-student specific
    maxBootstrappedDemos: 2,
    maxLabeledDemos: 1,

    // Progress tracking
    onProgress: (progress) => {
      if (progress.round % 3 === 0) {
        // Only show every 3rd trial
        console.log(
          `📈 Trial ${progress.round}/${progress.totalRounds}: Score ${progress.bestScore.toFixed(3)}`
        );
      }
    },
  });

  console.log('⚡ Starting optimization...');
  const optimizationResult = await optimizer.compile(
    algorithmImplementer,
    implementationQuality
  );

  console.log(`\n✅ Optimization completed!`);
  console.log(
    `🎯 Best score achieved: ${optimizationResult.bestScore?.toFixed(3)}`
  );
  console.log(`📊 Total trials: ${optimizationResult.stats.totalCalls}`);

  // Test the optimized model
  console.log('\n📝 Testing student model AFTER optimization:');

  const optimizedProgram =
    optimizationResult.optimizedGen || algorithmImplementer;

  for (const [i, task] of algorithmTasks.slice(0, 2).entries()) {
    try {
      const afterResult = await optimizedProgram.forward(studentAI, {
        algorithmName: task.algorithmName,
      });

      const result = afterResult.answer as {
        implementation: string;
        explanation: string;
        timeComplexity: string;
      };
      const score = await implementationQuality({
        prediction: result,
        example: task,
      });

      console.log(`\n📋 Task ${i + 1}: ${task.algorithmName}`);
      console.log(`📊 Quality score: ${score.toFixed(2)}`);
      console.log(`⏱️  Complexity: ${result.timeComplexity}`);

      if (i === 0) {
        // Show implementation for first task
        console.log(`💻 Implementation:\n${result.implementation}`);
      }
    } catch (error) {
      console.log(
        `❌ Task ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function main() {
  try {
    await demonstrateTeacherStudentOptimization();

    console.log('\n🎉 Teacher-student optimization completed!');
    console.log('\n📚 What happened:');
    console.log('• Large teacher model (Gemini Pro) guided the optimization');
    console.log(
      '• Small student model (SmolLM:360m) learned to implement algorithms'
    );
    console.log(
      '• Python optimizer service provided advanced optimization algorithms'
    );
    console.log(
      '• MiPRO found better prompts and examples to improve performance'
    );

    return 0;
  } catch (error) {
    console.error(
      '\n💥 Optimization failed:',
      error instanceof Error ? error.message : String(error)
    );
    return 1;
  }
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
