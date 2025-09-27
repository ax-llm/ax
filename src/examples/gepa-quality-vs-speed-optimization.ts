/**
 * GEPA Multi-Objective Optimization: Quality vs Speed
 *
 * This example demonstrates GEPA's unique ability to optimize for multiple conflicting objectives
 * simultaneously, finding the Pareto frontier of optimal trade-offs. Unlike single-objective
 * optimizers that find one "best" solution, GEPA discovers a set of non-dominated solutions
 * that represent different optimal balances between objectives.
 *
 * Task: Code review and bug detection
 * Objectives:
 * 1. Quality: Thorough, accurate analysis with detailed explanations
 * 2. Speed: Concise, fast responses that get to the point quickly
 *
 * These objectives naturally conflict - more thorough analysis takes more time and words,
 * while faster responses may miss important details. GEPA finds the optimal trade-offs.
 */

import { AxAI, AxAIOpenAIModel, AxGEPA, ax } from '../ax/index.js';

// Environment check
if (!process.env.OPENAI_APIKEY) {
  console.error('❌ OPENAI_APIKEY environment variable is required');
  process.exit(1);
}

// Define the code review program
const codeReviewer = ax(
  'code:string "Code to review for bugs and issues" -> analysis:string "Bug analysis and recommendations", severity:class "critical, moderate, minor" "Most severe issue found", confidence:number "0-1, confidence in the analysis"'
)

// Training examples: Code with various types of bugs
const codeExamples = [
  {
    code: `
function processPayment(amount, cardNumber) {
  // Process payment
  const fee = amount * 0.03;
  const total = amount + fee;

  // Log payment details
  console.log(\`Processing $\${total} for card \${cardNumber}\`);

  // Store in database
  database.payments.insert({
    amount: total,
    card: cardNumber,
    timestamp: Date.now()
  });

  return { success: true, total };
}`,
    expectedSeverity: 'critical',
    expectedIssues: [
      'PII logging',
      'SQL injection risk',
      'no input validation',
    ],
  },

  {
    code: `
async function fetchUserData(userId) {
  const user = await db.users.findById(userId);
  if (!user) {
    return null;
  }

  const posts = await db.posts.findByUserId(userId);
  const comments = await db.comments.findByUserId(userId);

  return {
    ...user,
    posts: posts,
    comments: comments
  };
}`,
    expectedSeverity: 'moderate',
    expectedIssues: [
      'N+1 query problem',
      'no error handling',
      'missing type checks',
    ],
  },

  {
    code: `
function calculateDiscount(price, customerType) {
  let discount = 0;

  if (customerType == 'premium') {
    discount = 0.15;
  } else if (customerType == 'standard') {
    discount = 0.05;
  }

  return price - (price * discount);
}`,
    expectedSeverity: 'minor',
    expectedIssues: ['loose equality', 'no input validation', 'magic numbers'],
  },

  {
    code: `
class DataProcessor {
  constructor() {
    this.cache = new Map();
  }

  process(data) {
    const key = JSON.stringify(data);

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const result = this.expensiveOperation(data);
    this.cache.set(key, result);

    return result;
  }

  expensiveOperation(data) {
    // Simulate expensive operation
    return data.map(item => item.value * 2);
  }
}`,
    expectedSeverity: 'moderate',
    expectedIssues: [
      'memory leak potential',
      'inefficient key generation',
      'no cache size limit',
    ],
  },

  {
    code: `
function validateEmail(email) {
  const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return regex.test(email);
}

function createUser(userData) {
  if (!validateEmail(userData.email)) {
    throw new Error('Invalid email');
  }

  const user = {
    id: Math.random().toString(36),
    email: userData.email,
    name: userData.name,
    createdAt: new Date().toISOString()
  };

  return user;
}`,
    expectedSeverity: 'moderate',
    expectedIssues: [
      'weak ID generation',
      'insufficient email validation',
      'no name validation',
    ],
  },

  {
    code: `
function quickSort(arr) {
  if (arr.length <= 1) return arr;

  const pivot = arr[0];
  const left = [];
  const right = [];

  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < pivot) {
      left.push(arr[i]);
    } else {
      right.push(arr[i]);
    }
  }

  return [...quickSort(left), pivot, ...quickSort(right)];
}`,
    expectedSeverity: 'minor',
    expectedIssues: [
      'worst-case O(n²) complexity',
      'poor pivot selection',
      'stack overflow risk',
    ],
  },
]

// Multi-objective evaluation metrics
const evaluateCodeReview = async ({
  prediction,
  example,
}: {
  prediction: any
  example: any
}) => {
  const analysis = prediction?.analysis || ''
  const severity = prediction?.severity || 'minor'
  const confidence = prediction?.confidence || 0

  // Quality Score (0-1): How thorough and accurate is the analysis?
  let qualityScore = 0

  // Check if analysis mentions expected issues
  const analysisLower = analysis.toLowerCase()
  const expectedIssues = example.expectedIssues || []
  const issuesFound = expectedIssues.filter((issue) =>
    analysisLower.includes(issue.toLowerCase().replace(/\s+/g, ''))
  ).length

  // Base quality on issue detection
  qualityScore += (issuesFound / Math.max(1, expectedIssues.length)) * 0.4

  // Reward severity accuracy
  if (severity === example.expectedSeverity) {
    qualityScore += 0.2
  }

  // Reward detailed explanations
  if (analysis.length > 100) qualityScore += 0.1
  if (analysis.includes('because') || analysis.includes('due to'))
    qualityScore += 0.1
  if (analysis.includes('recommend') || analysis.includes('should'))
    qualityScore += 0.1

  // Reward high confidence when correct
  if (confidence > 0.7 && severity === example.expectedSeverity) {
    qualityScore += 0.1
  }

  // Speed Score (0-1): How concise and efficient is the response?
  let speedScore = 1.0

  // Penalize verbosity - optimal analysis should be 50-200 words
  const wordCount = analysis.split(/\s+/).length
  if (wordCount > 200) {
    speedScore -= Math.min(0.5, (wordCount - 200) / 200)
  } else if (wordCount < 50) {
    speedScore -= Math.min(0.3, (50 - wordCount) / 50)
  }

  // Reward direct, actionable language
  if (analysisLower.includes('critical:') || analysisLower.includes('issue:'))
    speedScore += 0.1
  if (analysisLower.includes('fix:') || analysisLower.includes('solution:'))
    speedScore += 0.1

  // Ensure scores are in [0,1]
  qualityScore = Math.max(0, Math.min(1, qualityScore))
  speedScore = Math.max(0, Math.min(1, speedScore))

  return {
    quality: qualityScore,
    speed: speedScore,
  }
}

// AI models
const studentAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4OMini },
})

const teacherAI = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: AxAIOpenAIModel.GPT4O },
})

async function demonstrateGEPAOptimization() {
  console.log('🎯 GEPA Multi-Objective Optimization: Quality vs Speed')
  console.log('=====================================================')
  console.log(
    'Finding optimal trade-offs between thorough analysis and concise responses\n'
  )

  // Test baseline performance
  console.log('📊 Testing baseline performance before optimization...')

  const testExample = codeExamples[0]
  const baselineResult = await codeReviewer.forward(studentAI, {
    code: testExample.code,
  })

  const baselineScores = await evaluateCodeReview({
    prediction: baselineResult,
    example: testExample,
  })

  console.log(
    `📈 Baseline - Quality: ${baselineScores.quality.toFixed(
      3
    )}, Speed: ${baselineScores.speed.toFixed(3)}`
  )
  console.log('')

  // Configure GEPA optimizer
  const optimizer = new AxGEPA({
    studentAI,
    teacherAI,
    numTrials: 25,
    minibatch: true,
    minibatchSize: 4,
    earlyStoppingTrials: 8,
    sampleCount: 1,
    verbose: true,
    seed: 42,
  })

  console.log('🔧 Running GEPA Pareto optimization...')
  console.log(
    'Searching for optimal quality-speed trade-offs across the Pareto frontier\n'
  )

  const result = await optimizer.compile(
    codeReviewer as any,
    codeExamples,
    evaluateCodeReview as any,
    {
      auto: 'medium',
      verbose: true,
      maxMetricCalls: 150,
    } as any
  )

  console.log('\n✅ GEPA optimization completed!')
  console.log(
    `🎯 Pareto frontier contains ${result.paretoFrontSize} optimal solutions`
  )
  console.log(`📊 Hypervolume: ${result.hypervolume?.toFixed(4) || 'N/A'}`)
  console.log(`⚡ Total evaluations: ${result.stats.totalCalls}`)

  // Display Pareto frontier
  console.log('\n🏆 Pareto Frontier - Optimal Quality-Speed Trade-offs:')
  console.log('='.repeat(60))

  const sortedFrontier = [...result.paretoFront]
    .sort((a, b) => {
      // Sort by quality descending, then speed descending
      const qualityDiff =
        ((b.scores as any).quality || 0) - ((a.scores as any).quality || 0)
      if (Math.abs(qualityDiff) > 0.01) return qualityDiff
      return ((b.scores as any).speed || 0) - ((a.scores as any).speed || 0)
    })
    .slice(0, 8) // Show top 8 solutions

  for (const [index, point] of sortedFrontier.entries()) {
    const quality = (point.scores as any).quality || 0
    const speed = (point.scores as any).speed || 0
    const profile = getTradeoffProfile(quality, speed)

    console.log(`${index + 1}. ${profile}`)
    console.log(
      `   Quality: ${quality.toFixed(3)} | Speed: ${speed.toFixed(3)}`
    )
    if (point.configuration) {
      const config = JSON.stringify(point.configuration).slice(0, 80)
      console.log(`   Config: ${config}${config.length === 80 ? '...' : ''}`)
    }
    console.log('')
  }

  // Test different Pareto points
  console.log('🧪 Testing Pareto solutions on new code examples:\n')

  // Create test programs for different trade-off points
  const highQualityPoint =
    sortedFrontier.find((p) => ((p.scores as any).quality || 0) > 0.7) ||
    sortedFrontier[0]

  const balancedPoint =
    sortedFrontier.find((p) => {
      const quality = (p.scores as any).quality || 0
      const speed = (p.scores as any).speed || 0
      return Math.abs(quality - speed) < 0.2
    }) || sortedFrontier[Math.floor(sortedFrontier.length / 2)]

  const highSpeedPoint =
    sortedFrontier.find((p) => ((p.scores as any).speed || 0) > 0.7) ||
    sortedFrontier[sortedFrontier.length - 1]

  const testCases = [
    { name: 'High Quality', point: highQualityPoint },
    { name: 'Balanced', point: balancedPoint },
    { name: 'High Speed', point: highSpeedPoint },
  ]

  const newTestCode = `
function transferFunds(fromAccount, toAccount, amount) {
  if (fromAccount.balance >= amount) {
    fromAccount.balance -= amount;
    toAccount.balance += amount;
    return true;
  }
  return false;
}`

  for (const testCase of testCases) {
    if (!testCase.point) continue

    console.log(`📋 ${testCase.name} Strategy:`)

    // Apply configuration (simulated - in real implementation, this would set prompt/parameters)
    const testResult = await codeReviewer.forward(studentAI, {
      code: newTestCode,
    })

    const scores = await evaluateCodeReview({
      prediction: testResult,
      example: {
        expectedSeverity: 'critical',
        expectedIssues: [
          'race condition',
          'no validation',
          'no error handling',
        ],
      },
    })

    console.log(
      `   Quality: ${scores.quality.toFixed(3)} | Speed: ${scores.speed.toFixed(
        3
      )}`
    )
    console.log(`   Analysis: ${testResult.analysis.slice(0, 100)}...`)
    console.log('')
  }

  console.log('🎉 GEPA Multi-Objective Optimization Complete!\n')
  console.log('💡 Key Insights:')
  console.log('• GEPA found multiple optimal solutions instead of just one')
  console.log(
    '• Each Pareto point represents a different quality-speed trade-off'
  )
  console.log(
    '• You can choose the solution that best fits your specific needs'
  )
  console.log(
    '• No single solution dominates all others - each has its strengths'
  )
  console.log(
    '• The Pareto frontier reveals the true cost of prioritizing one objective'
  )

  return result
}

function getTradeoffProfile(quality: number, speed: number): string {
  if (quality > 0.8 && speed > 0.8)
    return '🌟 High Quality + High Speed (Rare!)'
  if (quality > 0.7 && speed < 0.5)
    return '🔍 Thorough Analysis (Quality-focused)'
  if (quality < 0.5 && speed > 0.7) return '⚡ Quick Assessment (Speed-focused)'
  if (Math.abs(quality - speed) < 0.15) return '⚖️  Balanced Trade-off'
  if (quality > speed) return '📚 Quality-leaning'
  return '🏃 Speed-leaning'
}

async function main() {
  try {
    const result = await demonstrateGEPAOptimization()

    console.log('\n📊 Summary Statistics:')
    console.log(`   Pareto frontier size: ${result.paretoFrontSize}`)
    console.log(
      `   Hypervolume improvement: ${((result.hypervolume || 0) * 100).toFixed(
        1
      )}%`
    )
    console.log(`   Total trials: ${result.stats.totalCalls}`)
    console.log(
      `   Best quality score: ${Math.max(
        ...result.paretoFront.map((p) => (p.scores as any).quality || 0)
      ).toFixed(3)}`
    )
    console.log(
      `   Best speed score: ${Math.max(
        ...result.paretoFront.map((p) => (p.scores as any).speed || 0)
      ).toFixed(3)}`
    )

    return 0
  } catch (error) {
    console.error(
      '\n💥 GEPA optimization failed:',
      error instanceof Error ? error.message : String(error)
    )
    return 1
  }
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((error) => {
    console.error('💥 Unexpected error:', error)
    process.exit(1)
  })
