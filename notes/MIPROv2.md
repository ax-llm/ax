# AxMiPRO v2: In-Depth Implementation Guide

This document provides a detailed explanation of our enhanced `AxMiPRO` optimizer, a sophisticated tool for automatically optimizing language model (LM) programs. It's designed based on the principles outlined in the [MIPRO paper](https://arxiv.org/html/2406.11695v2), focusing on AI-driven instruction generation and efficient search strategies.

## Overview

`AxMiPRO` (Multi-task Instruction-based Program Optimizer) is an optimizer that automates the tuning of `AxProgram` instances (like `AxGen`). The primary goal is to find the optimal combination of **instructions** and **few-shot examples** that maximizes a program's performance on a given task, as measured by a user-defined metric.

Our v2 implementation moves beyond simple template-based optimization by integrating several advanced techniques from the MIPRO paper, including:
1.  **AI-Powered Instruction Generation**: Using a "teacher" LLM to craft high-quality, context-aware instructions.
2.  **Bayesian Optimization**: Employing a surrogate model to intelligently and efficiently search the vast configuration space.
3.  **Adaptive Evaluation**: Using minibatching to balance optimization speed with evaluation accuracy.
4.  **Self-Consistency (Multi-Sample Voting)**: Requesting multiple completions per prompt (`sampleCount`) and aggregating them (e.g. majority vote) for more robust scoring.

## How It Works: The Optimization Process

The `AxMiPRO` optimizer follows a structured process to find the best program configuration.

![MIPRO Flow](https://i.imgur.com/your-diagram-image.png) <!-- placeholder -->

1.  **Initialization**: The optimizer is initialized with a student AI (the model to be optimized), an optional teacher AI (a more powerful model for generation tasks), and a set of training examples.

2.  **Candidate Generation (The Building Blocks)**:
    *   **Instruction Candidates**: `AxMiPRO` uses its AI-powered proposer to generate a diverse set of instruction candidates. This is a key enhancement over static templates.
    *   **Few-Shot Demonstration Candidates**: It runs `AxBootstrapFewShot` to generate high-quality few-shot demonstrations from the training data.
    *   **Labeled Example Candidates**: It selects a random subset of the training data to be used as labeled examples.

3.  **Optimization Loop**: The core of `AxMiPRO` is an iterative loop that runs for a specified number of trials (`numTrials`). In each trial, it performs the following steps:
    a. **Select Configuration**: It selects a configuration to test. A configuration consists of:
        - An instruction from the candidate pool.
        - A number of few-shot demonstrations to use.
        - A number of labeled examples to use.
       This selection is done either randomly (during the initial exploration phase) or intelligently using the Bayesian optimization strategy.

    b. **Evaluate Configuration**: The chosen configuration is applied to a copy of the user's program. This temporary program is then evaluated against a validation set (`valset`). To speed things up, evaluation is often done on a smaller, random subset of the validation data (a "minibatch"). The performance is scored using the user-provided metric function.

    c. **Update Best Score**: If the current configuration's score is better than the best score found so far, it's saved as the new best configuration.

    d. **Update Surrogate Model**: The result of the trial (the configuration and its score) is used to update the internal surrogate model, refining its understanding of the performance landscape for future decisions.

4.  **Completion**: After all trials are complete (or if an early stopping condition is met), the optimizer returns the best-performing configuration. This result includes the optimized instruction, the best set of few-shot demos, and a ready-to-use `AxGen` instance (`optimizedGen`) with the best settings applied.

## Key Features in Detail

Our `AxMiPRO` implementation includes several powerful features that mirror the research paper's core contributions.

### 1. AI-Powered Instruction Generation

This is the most significant enhancement. Instead of relying on a small set of predefined, static instruction templates, `AxMiPRO` uses an LLM (typically a powerful "teacher" model) to generate diverse and contextually relevant instructions.

-   **Program-Aware Proposer**: Analyzes the program's signature (inputs and outputs) to understand its purpose and structure.
-   **Data-Aware Proposer**: Analyzes a sample of the training data to identify patterns, domain, and key characteristics.
-   **Tip-Aware Proposer**: Injects creative "tips" (e.g., "Focus on step-by-step reasoning") to guide the instruction generation process towards different styles.
-   **Few-shot-Aware Proposer**: Remembers recently generated instructions to ensure diversity and avoid repetition.

### 2. Bayesian Optimization with a Surrogate Model

To avoid a costly and inefficient random search, `AxMiPRO` uses Bayesian optimization.

-   **Surrogate Model**: It maintains a lightweight surrogate model (a Gaussian Process approximation) that predicts the performance of a given configuration *without* actually running a full evaluation.
-   **Acquisition Functions**: It uses an acquisition function to decide which configuration to try next. This function intelligently balances:
    -   **Exploitation**: Trying configurations the model predicts will perform well.
    -   **Exploration**: Trying configurations with high uncertainty to learn more about the performance landscape.
-   **Supported Functions**: `expected_improvement` (default), `upper_confidence_bound`, and `probability_improvement`.

### 3. Adaptive Minibatch Evaluation

Full evaluations on a large validation set are slow and expensive. `AxMiPRO` employs an adaptive minibatching strategy.

-   **Stochastic Evaluation**: In most trials, it evaluates configurations on a small, random subset of the validation data.
-   **Adaptive Sizing**: It can start with small minibatches and increase their size for more promising configurations or in later stages of optimization.
-   **Scheduled Full Evaluation**: It periodically runs a full evaluation to get a more accurate score for the leading candidates.

### 4. Self-Consistency with Multiple Samples (`sampleCount`)

Recent research (e.g. "Self-Consistency Improves Chain-of-Thought Reasoning") shows that asking the model for *k* independent samples and then selecting the best one often boosts accuracy. `AxMiPRO v2` now exposes this capability via the **`sampleCount`** option:

*   During evaluation it calls `program.forward()` with `{ sampleCount: k }`.
*   A lightweight **majority-vote result picker** (`axMajorityVotePicker`) chooses the most frequent answer (ties → first seen).
*   If `sampleCount === 1` the overhead is zero – the feature is pay-as-you-go.

> **Design note**  `sampleCount` currently lives in `AxMiPROOptimizerOptions` because only MiPRO uses it. In the future it may graduate to the **optimizer-level interface** (`AxOptimizerArgs` / `AxCompileOptions`) so that other optimizers (e.g. Pareto, Bootstrap) can reuse the same mechanism.

## Usage Example

Here's how to use the enhanced `AxMiPRO` optimizer with its new features.

```typescript
import { ax, AxAI, AxMiPRO, type AxMetricFn, f } from '@ax-llm/ax';

// 1. Define student and teacher AIs
const studentAI = new AxAI({ name: 'openai', config: { model: 'gpt-4o-mini' } });
const teacherAI = new AxAI({ name: 'openai', config: { model: 'gpt-4o' } });

// 2. Define the program to be optimized
export const emailClassifier = ax`
  emailText:${f.string('Email content')} -> 
  category:${f.class(['urgent', 'important', 'normal', 'spam'])},
  confidence:${f.number('Confidence score 0-1')}
`;

// 3. Create training data and a metric
const trainingExamples = [/* ... your examples ... */];
const validationExamples = [/* ... your examples ... */];
const classificationMetric: AxMetricFn = ({ prediction, example }) => {
  return prediction.category === example.category ? 1 : 0;
};

// 4. Configure and run the optimizer
const optimizer = new AxMiPRO({
  studentAI,
  teacherAI, // Use a powerful teacher model
  examples: trainingExamples,
  options: {
    // Core settings
    numCandidates: 5,
    numTrials: 20,

    // Enable all new AI-powered features
    programAwareProposer: true,
    dataAwareProposer: true,
    tipAwareProposer: true,

    // Enable Bayesian optimization
    bayesianOptimization: true,
    acquisitionFunction: 'expected_improvement',

    // Enable adaptive evaluation
    minibatch: true,
    minibatchSize: 20,
    // Self-consistency: ask for 3 samples and vote
    sampleCount: 3,
    
    verbose: true
  }
});

const result = await optimizer.compile(emailClassifier, classificationMetric, {
  validationExamples: validationExamples
});

// 5. Use the optimized generator
if (result.optimizedGen) {
  const classification = await result.optimizedGen.forward(studentAI, {
    emailText: "URGENT: Server outage detected"
  });
  console.log(classification.category); // 'urgent'
}
```

## Implementation Status & Future Work

Based on a recent audit against the MIPRO research paper, here is the current status of our implementation.

| Component              | Paper Requirement               | Our Implementation                | Status       |
| ---------------------- | ------------------------------- | --------------------------------- | ------------ |
| Instruction Generation | AI-powered with context         | ✅ Full AI integration            | **COMPLETE** |
| Surrogate Model        | Bayesian optimization           | ✅ Gaussian Process + acquisition | **COMPLETE** |
| Program Awareness      | Structure analysis              | ✅ Signature analysis + summary   | **COMPLETE** |
| Data Awareness         | Dataset summarization           | ✅ Sample analysis + summary      | **COMPLETE** |
| Minibatch Evaluation   | Stochastic + adaptive           | ✅ Adaptive sizing + sampling     | **COMPLETE** |
| Few-shot Bootstrap     | High-quality demos              | ✅ Advanced bootstrapping         | **COMPLETE** |
| Self-Consistency       | Multi-sample voting             | ✅ `sampleCount` + majority vote  | **COMPLETE** |
| **Multi-Module Support**   | Pipeline optimization           | 🔶 Single program only            | **PARTIAL**  |
| **Meta-Optimization**      | Proposer improvement over time  | ❌ Static approach                | **MISSING**  |

### Strengths

Our implementation successfully captures all the core innovations of the MIPRO paper, delivering a powerful, state-of-the-art optimizer. The combination of AI-powered proposers and Bayesian search allows for more effective and efficient tuning than previously possible.

### Weaknesses & Future Work

While powerful, our implementation has room for growth to fully realize the paper's vision.

1.  **Multi-Module Support (High Priority)**
    -   **What it is**: The paper describes optimizing multi-step LM programs (or "pipelines") where the output of one program is the input to another. This requires sophisticated credit assignment to determine which module in the chain is responsible for a final error.
    -   **Our Status**: We currently only optimize single, self-contained programs. This is a key area for future work to support more complex agentic workflows.

2.  **Meta-Optimization (Medium Priority)**
    -   **What it is**: A true meta-optimizer learns and improves its own strategies over time. For example, it could learn which "tips" for instruction generation work best for certain types of tasks by analyzing performance across many different optimization runs.
    -   **Our Status**: Our proposers are static. They use the same strategy for every run. Implementing a meta-learning layer would be a significant step towards a more intelligent optimization system.

### Conclusion

Our `AxMiPRO v2` is a cutting-edge implementation that brings the core advancements of the MIPRO research paper into our framework. It delivers a **~13% accuracy improvement** on complex tasks (as per the paper's findings) by replacing brittle, template-based methods with intelligent, AI-driven optimization.

While future work on multi-module support and meta-optimization remains, the current tool provides a massive leap in our ability to automatically build high-performance, production-ready LM programs. 