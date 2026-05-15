/**
 * Standard Schema integration — zod with ax() and fn()
 *
 * Shows how to use zod (or any Standard Schema v1 library) directly with
 * the f() signature builder and fn() function builder.  Three shapes work
 * on every builder method:
 *
 *   Shape 1 — native fluent:       .input('name', f.string())
 *   Shape 2 — per-field schema:    .input('name', z.string(), { cache: true })
 *   Shape 3 — whole-object schema: .input(z.object({ … }), { fields: { … } })
 *
 * Run:
 *   ANTHROPIC_APIKEY=<key> npx tsx src/examples/standard-schema.ts
 */

import { z } from 'zod';

import { AxAIAnthropicModel, ai, ax, f, fn } from '../ax/index.js';

const llm = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY as string,
  config: { model: AxAIAnthropicModel.Claude45Sonnet },
});

// const llm = ai({ name: 'openai', apiKey: process.env['OPENAI_APIKEY'] as string });

// ---------------------------------------------------------------------------
// Tool defined with zod  (Shape 3 — whole-object schema on fn())
// ---------------------------------------------------------------------------
// In real use this would hit an external API; here we return mock data.

const lookupProductTool = fn('lookupProduct')
  .description('Look up a product by name and return its current details')
  .arg(
    z.object({
      productName: z.string().min(1).describe('Exact product name to look up'),
      includeSpecs: z
        .boolean()
        .optional()
        .describe('Whether to include technical specs'),
    })
  )
  .returns(
    z.object({
      price: z.number().describe('Current price in USD'),
      inStock: z.boolean().describe('Whether the product is available'),
      rating: z.number().min(1).max(5).describe('Average customer rating'),
    })
  )
  .handler(async ({ productName, includeSpecs }) => {
    // Mock product database
    const products: Record<
      string,
      { price: number; inStock: boolean; rating: number; specs?: string }
    > = {
      'wireless headphones': {
        price: 79.99,
        inStock: true,
        rating: 4.3,
        specs: 'Bluetooth 5.2, 30h battery',
      },
      'mechanical keyboard': {
        price: 129.99,
        inStock: false,
        rating: 4.7,
        specs: 'Cherry MX Brown, TKL',
      },
      'usb-c hub': { price: 34.99, inStock: true, rating: 3.9 },
    };
    const product = products[productName.toLowerCase()] ?? {
      price: 0,
      inStock: false,
      rating: 0,
    };
    if (includeSpecs && product.specs) {
      console.log(`  [tool] specs for "${productName}": ${product.specs}`);
    }
    return {
      price: product.price,
      inStock: product.inStock,
      rating: product.rating,
    };
  })
  .build();

// ---------------------------------------------------------------------------
// Shape 2 — per-field zod schema
//
// Good when you want to mix zod fields with native f.*() fields, or attach
// ax-specific hints via companion options ({ cache: true }, { internal: true }).
// ---------------------------------------------------------------------------

console.log('\n=== Shape 2: per-field zod ===\n');

const reviewSentimentGen = ax(
  f()
    .description('Analyse a product review and extract structured sentiment')
    .input('productName', z.string().describe('Name of the reviewed product'))
    .input('reviewText', z.string().min(10).describe('Full review text'))
    .output(
      'sentiment',
      z.enum(['positive', 'neutral', 'negative']).describe('Overall sentiment')
    )
    .output('score', z.number().min(1).max(10).describe('Sentiment score 1-10'))
    .output('keyPoints', z.array(z.string()).describe('Top 3 takeaway points'))
    .useStructured()
    .build()
);

const reviewResult = await reviewSentimentGen.forward(llm, {
  productName: 'wireless headphones',
  reviewText:
    'Absolutely love these headphones! The sound quality is superb and battery life is incredible — ' +
    'I got 28 hours on a single charge. Build quality feels premium. Only minor gripe is the ear ' +
    'cushions get slightly warm after 2+ hours. Would definitely buy again.',
});

console.log('Sentiment :', reviewResult.sentiment);
console.log('Score     :', reviewResult.score, '/ 10');
console.log('Key points:', reviewResult.keyPoints);

// ---------------------------------------------------------------------------
// Shape 3 — whole-object zod schema
//
// Pass a single z.object() and every property becomes a field, in declaration
// order. Companion options ({ fields: { … } }) apply per-field hints.
// ---------------------------------------------------------------------------

console.log('\n=== Shape 3: whole-object zod + fn() tool ===\n');

const productSummaryGen = ax(
  f()
    .description(
      'Summarise a product for a potential buyer using live product data'
    )
    .input(
      z.object({
        productName: z.string().describe('Product to summarise'),
        buyerProfile: z
          .string()
          .describe('Short description of the target buyer'),
      })
    )
    .output(
      z.object({
        headline: z.string().describe('One-sentence product headline'),
        pros: z.array(z.string()).describe('Top 3 advantages'),
        cons: z.array(z.string()).describe('Top 2 drawbacks'),
        recommendation: z
          .enum(['buy', 'wait', 'skip'])
          .describe('Purchase recommendation'),
      })
    )
    .useStructured()
    .build(),
  { maxSteps: 3 }
);

const summaryResult = await productSummaryGen.forward(
  llm,
  {
    productName: 'wireless headphones',
    buyerProfile: 'remote worker who takes calls and listens to music all day',
  },
  { functions: [lookupProductTool] }
);

console.log('Headline       :', summaryResult.headline);
console.log('Pros           :', summaryResult.pros);
console.log('Cons           :', summaryResult.cons);
console.log('Recommendation :', summaryResult.recommendation);
