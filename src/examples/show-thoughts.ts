import {
  AxAI,
  AxAIGoogleGeminiModel,
  AxAIOpenAIResponsesModel,
  AxGen,
} from '@ax-llm/ax';

// Example demonstrating the showThoughts feature
// This allows you to see the model's reasoning process

const main = async () => {
  // For Gemini: includeThoughts config controls reasoning visibility
  const gemini = new AxAI({
    name: 'google-gemini',
    apiKey: process.env.GOOGLE_APIKEY || '',
    config: {
      model: AxAIGoogleGeminiModel.Gemini25Flash,
      thinking: {
        // Can be set at the AI level as default
        includeThoughts: false, // Default to false, will be overridden per request
      },
    },
  });

  // For OpenAI Responses API: encrypted_content provides reasoning when requested
  // Note: Regular OpenAI chat API doesn't support showThoughts, only the Responses API does
  const openaiResponses = new AxAI({
    name: 'openai-responses',
    apiKey: process.env.OPENAI_APIKEY || '',
    config: {
      model: AxAIOpenAIResponsesModel.O1,
    },
  });

  const signature = `question:string -> answer:string "thoughtful response"`;

  const gen = new AxGen(signature, {
    // Custom field name for thoughts (optional, defaults to "thought")
    thoughtFieldName: 'reasoning',
  });

  const question = {
    question:
      'How would you solve the traveling salesman problem for 5 cities?',
  };

  console.log('=== Example: Gemini with showThoughts enabled ===');
  try {
    const resultWithThoughts = await gen.forward(gemini, question, {
      showThoughts: true, // Enable reasoning visibility
    });

    console.log('Answer:', resultWithThoughts.answer);
    console.log(
      'Reasoning:',
      resultWithThoughts.reasoning || 'No reasoning provided'
    );
  } catch (error) {
    console.log(
      'Gemini error:',
      error instanceof Error ? error.message : error
    );
  }

  console.log('\n=== Example: Gemini with showThoughts disabled ===');
  try {
    const resultWithoutThoughts = await gen.forward(gemini, question, {
      showThoughts: false, // Disable reasoning visibility
    });

    console.log('Answer:', resultWithoutThoughts.answer);
    console.log(
      'Reasoning:',
      resultWithoutThoughts.reasoning || 'No reasoning provided'
    );
  } catch (error) {
    console.log(
      'Gemini error:',
      error instanceof Error ? error.message : error
    );
  }

  // Check if OpenAI API key is available and if the API supports showThoughts
  if (process.env.OPENAI_APIKEY) {
    console.log(
      '\n=== Example: OpenAI Responses API with showThoughts enabled ==='
    );
    try {
      const openaiResultWithThoughts = await gen.forward(
        openaiResponses,
        question,
        {
          showThoughts: true, // Request encrypted_content in the response
        }
      );

      console.log('Answer:', openaiResultWithThoughts.answer);
      console.log(
        'Reasoning:',
        openaiResultWithThoughts.reasoning || 'No reasoning provided'
      );
    } catch (error) {
      console.log(
        'OpenAI Responses API error:',
        error instanceof Error ? error.message : error
      );
    }

    console.log(
      '\n=== Example: OpenAI Responses API with showThoughts disabled ==='
    );
    try {
      const openaiResultWithoutThoughts = await gen.forward(
        openaiResponses,
        question,
        {
          showThoughts: false, // Don't request encrypted_content
        }
      );

      console.log('Answer:', openaiResultWithoutThoughts.answer);
      console.log(
        'Reasoning:',
        openaiResultWithoutThoughts.reasoning || 'No reasoning provided'
      );
    } catch (error) {
      console.log(
        'OpenAI Responses API error:',
        error instanceof Error ? error.message : error
      );
    }
  } else {
    console.log('\n=== OpenAI Examples Skipped ===');
    console.log(
      'OPENAI_APIKEY not provided. Set it to see OpenAI Responses API examples.'
    );
  }

  console.log('\n=== Example: Streaming with showThoughts ===');
  try {
    const stream = gen.streamingForward(gemini, question, {
      showThoughts: true,
    });

    console.log('Streaming response:');
    for await (const chunk of stream) {
      if (chunk.delta.reasoning) {
        console.log('💭 Reasoning chunk:', chunk.delta.reasoning);
      }
      if (chunk.delta.answer) {
        console.log('💬 Answer chunk:', chunk.delta.answer);
      }
    }
  } catch (error) {
    console.log(
      'Streaming error:',
      error instanceof Error ? error.message : error
    );
  }

  console.log('\n=== Example: thinkingTokenBudget="none" constraint ===');
  try {
    const resultWithNoneThinking = await gen.forward(gemini, question, {
      thinkingTokenBudget: 'none', // This automatically sets showThoughts to false
      showThoughts: true, // This will be overridden to false due to thinkingTokenBudget="none"
    });

    console.log('Answer:', resultWithNoneThinking.answer);
    console.log(
      'Reasoning:',
      resultWithNoneThinking.reasoning ||
        'No reasoning provided (expected when thinkingTokenBudget="none")'
    );
    console.log(
      'ℹ️ Note: showThoughts=true was overridden to false because thinkingTokenBudget="none"'
    );
  } catch (error) {
    console.log(
      'Gemini error:',
      error instanceof Error ? error.message : error
    );
  }

  console.log('\n=== Feature Support Information ===');
  console.log('📋 APIs that support showThoughts:');
  console.log('  ✅ google-gemini (Gemini models with thinking capabilities)');
  console.log('  ✅ openai-responses (OpenAI Responses API with o1 models)');
  console.log(
    '  ❌ openai (Regular OpenAI Chat API - use openai-responses instead)'
  );
  console.log('  ❌ Most other providers (feature not yet implemented)');
  console.log('\n📋 thinkingTokenBudget constraint:');
  console.log(
    '  When thinkingTokenBudget="none", showThoughts is automatically set to false'
  );
  console.log(
    '  This ensures no thinking/reasoning content is returned when budget is disabled'
  );
};

// Error handling for missing API keys
if (!process.env.GOOGLE_APIKEY && !process.env.OPENAI_APIKEY) {
  console.log(
    'Please set GOOGLE_APIKEY and/or OPENAI_APIKEY environment variables'
  );
  console.log('Example usage:');
  console.log(
    'GOOGLE_APIKEY=your_key npm run tsx src/examples/show-thoughts.ts'
  );
  console.log(
    'GOOGLE_APIKEY=your_key OPENAI_APIKEY=your_key npm run tsx src/examples/show-thoughts.ts'
  );
  process.exit(1);
}

main().catch(console.error);
