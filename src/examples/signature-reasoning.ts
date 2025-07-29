import { AxAI, AxAIGoogleGeminiModel, ax, s, f } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

console.log('=== Signature with Reasoning Examples ===');

// Example 1: Using `ax` template literal with reasoning field
const reasoningAnalyzer = ax`
  userQuestion:${f.string('Question from user')} -> 
  reasoning:${f.string('Step-by-step analysis of the question')},
  finalAnswer:${f.string('Comprehensive answer based on reasoning')},
  confidence:${f.number('Confidence level 0-1')}
`;

const analysisResult = await reasoningAnalyzer.forward(ai, {
  userQuestion: 'What are the main factors that contribute to climate change?'
});

console.log('Analysis with Reasoning:');
console.log('Question:', 'What are the main factors that contribute to climate change?');
console.log('Reasoning:', analysisResult.reasoning);
console.log('Final Answer:', analysisResult.finalAnswer);
console.log('Confidence:', analysisResult.confidence);

console.log('\n=== Problem Solving with Detailed Reasoning ===');

// Example 2: Math problem solver with reasoning chain
const mathReasoner = ax`
  problemStatement:${f.string('Mathematical problem to solve')} -> 
  stepByStepReasoning:${f.string('Detailed step-by-step solution process')},
  finalCalculation:${f.string('Final calculation with result')},
  answer:${f.number('Numerical answer')}
`;

const mathResult = await mathReasoner.forward(ai, {
  problemStatement: 'A rectangle has a length of 12 meters and a width of 8 meters. What is its area and perimeter?'
});

console.log('Math Problem with Reasoning:');
console.log('Problem:', mathResult.problemStatement);
console.log('Step-by-step Reasoning:', mathResult.stepByStepReasoning);
console.log('Final Calculation:', mathResult.finalCalculation);
console.log('Answer:', mathResult.answer);

console.log('\n=== Decision Making with Reasoning ===');

// Example 3: Decision maker with pros/cons reasoning
const decisionMaker = ax`
  scenario:${f.string('Decision scenario to analyze')} -> 
  prosAndCons:${f.string('Analysis of advantages and disadvantages')},
  reasoningProcess:${f.string('Logical reasoning behind the recommendation')},
  recommendation:${f.string('Final recommendation')},
  riskLevel:${f.class(['low', 'medium', 'high'], 'Risk assessment')}
`;

const decisionResult = await decisionMaker.forward(ai, {
  scenario: 'Should a small startup invest 50% of their budget in marketing or product development?'
});

console.log('Decision Analysis:');
console.log('Scenario:', decisionResult.scenario);
console.log('Pros and Cons:', decisionResult.prosAndCons);
console.log('Reasoning Process:', decisionResult.reasoningProcess);
console.log('Recommendation:', decisionResult.recommendation);
console.log('Risk Level:', decisionResult.riskLevel);

export { reasoningAnalyzer, mathReasoner, decisionMaker };