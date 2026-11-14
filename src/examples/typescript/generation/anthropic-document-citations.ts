// ax-example:start
// title: Anthropic document citations
// group: generation
// description: Preserve source passages and their supporting citations through ordinary and streaming Ax generation.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// ax-example:end
import { AxAIAnthropicModel, ai, ax } from '@ax-llm/ax';

const model = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_APIKEY,
  config: { model: AxAIAnthropicModel.Claude55Haiku, maxTokens: 1024 },
});

const source = {
  source: {
    type: 'text' as const,
    data: 'The Aurora Museum opens at 09:00. The museum is closed on Mondays.',
  },
  title: 'Museum visitor information',
  citations: { enabled: true },
};

for (const stream of [false, true]) {
  const program = ax(
    'source:file, question:string -> answer:string "Answer the question and cite the supplied document for each claim"'
  );
  const input = {
    source,
    question: 'When does the museum open, and which day is it closed?',
  };
  const options = {
    thinkingTokenBudget: 'low' as const,
    showThoughts: false,
    abortSignal: AbortSignal.timeout(60_000),
  };
  if (stream) {
    for await (const _ of program.streamingForward(model, input, options)) {
      // Text blocks are retained in the chat log as the response arrives.
    }
  } else {
    await program.forward(model, input, { ...options, stream: false });
  }

  const blocks = program.getChatLog().at(-1)?.textBlocks ?? [];
  const citedBlocks = blocks.filter((block) => block.citations?.length);
  if (!citedBlocks.length)
    throw new Error('Expected native document citations');
  for (const block of citedBlocks) {
    for (const citation of block.citations ?? []) {
      if (
        citation.type !== 'char_location' ||
        citation.startCharIndex === undefined ||
        citation.endCharIndex === undefined ||
        source.source.data.slice(
          citation.startCharIndex,
          citation.endCharIndex
        ) !== citation.snippet
      ) {
        throw new Error('Citation does not match the supplied source passage');
      }
    }
  }
  console.log(JSON.stringify({ stream, blocks: citedBlocks }, null, 2));
}
