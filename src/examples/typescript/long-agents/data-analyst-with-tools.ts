// ax-example:start
// title: TypeScript Data Analyst (Large Context + Tools)
// group: long-agents
// description: Combines a large data dictionary held in contextFields with typed fn() warehouse tools, so the agent answers business questions over a big dataset it never has to inline.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 30
// ax-example:end
import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;
if (!apiKey) {
  throw new Error('Set GOOGLE_APIKEY to run this example.');
}

const llm = ai({
  name: 'google-gemini',
  apiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Flash,
  },
});

// ---------------------------------------------------------------------------
// The "warehouse": a few hundred rows that live in the host process and are
// reachable only through tools. The model never sees the rows — it queries them.
// Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
type Row = {
  region: string;
  product: string;
  monthIndex: number;
  month: string;
  units: number;
  revenue: number;
  returnRate: number;
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function buildWarehouse(): Row[] {
  const regions = [
    'North',
    'South',
    'East',
    'West',
    'Central',
    'NW',
    'NE',
    'SE',
  ];
  const products = ['Widget-A', 'Widget-B', 'Gadget-X', 'Gadget-Y'];
  const rows: Row[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (const region of regions) {
    for (const product of products) {
      const trend = product === 'Gadget-X' && region === 'East' ? 90 : 25; // a planted winner
      for (let m = 0; m < MONTHS.length; m++) {
        const units = Math.round(400 + rand() * 1200 + m * trend);
        const price = product.startsWith('Gadget') ? 60 : 38;
        const returnRate = +(
          0.01 +
          rand() * 0.05 +
          (product === 'Widget-B' ? 0.03 : 0)
        ).toFixed(3);
        rows.push({
          region,
          product,
          monthIndex: m,
          month: MONTHS[m],
          units,
          revenue: units * price,
          returnRate,
        });
      }
    }
  }
  return rows;
}

const warehouse = buildWarehouse();

// The schema/data dictionary is large-ish and goes into contextFields, so the
// agent can orient itself on column meaning and business rules without the doc
// ever entering the prompt.
const schema = `
TABLE sales (one row per region x product x month)

COLUMNS
  region       text   one of: North, South, East, West, Central, NW, NE, SE
  product      text   one of: Widget-A, Widget-B, Gadget-X, Gadget-Y
  month        text   Jan..Dec (calendar order; monthIndex 0..11)
  units        int    units sold that month
  revenue      int    integer dollars (units * unit price; Gadgets cost more)
  returnRate   float  fraction of units returned, 0..1

BUSINESS RULES
  - "Growth" = change in monthly revenue from Jan to Dec for a region+product.
  - A return rate above 0.05 (5%) is flagged for quality review.
  - Compare like-for-like: always group by region AND product, not either alone.

TOOLS AVAILABLE
  warehouse.query   filter + aggregate a slice
  warehouse.top     rank a metric grouped by product or region
  warehouse.trend   monthly revenue series (Jan..Dec) for one region+product
`.trim();

const queryTool = fn('query')
  .namespace('warehouse')
  .description(
    'Filter the sales table and return aggregates for the matching rows.'
  )
  .arg('region', f.string('Optional region filter').optional())
  .arg('product', f.string('Optional product filter').optional())
  .arg('month', f.string('Optional month filter, e.g. Jan').optional())
  .returns(
    f.object({
      matched: f.number('Number of rows matched'),
      totalUnits: f.number(),
      totalRevenue: f.number(),
      avgReturnRate: f.number(),
    })
  )
  .handler(({ region, product, month }) => {
    const rows = warehouse.filter(
      (r) =>
        (!region || r.region === region) &&
        (!product || r.product === product) &&
        (!month || r.month === month)
    );
    const totalUnits = rows.reduce((s, r) => s + r.units, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const avgReturnRate = rows.length
      ? +(rows.reduce((s, r) => s + r.returnRate, 0) / rows.length).toFixed(4)
      : 0;
    return { matched: rows.length, totalUnits, totalRevenue, avgReturnRate };
  })
  .build();

const topTool = fn('top')
  .namespace('warehouse')
  .description('Rank a metric grouped by product or region, highest first.')
  .arg('metric', f.string('revenue or units'))
  .arg('groupBy', f.string('product or region'))
  .arg('limit', f.number('How many groups to return').optional())
  .returns(f.json('Array of { key, value } sorted by value descending'))
  .handler(({ metric, groupBy, limit }) => {
    const totals = new Map<string, number>();
    for (const r of warehouse) {
      const key = groupBy === 'region' ? r.region : r.product;
      const value = metric === 'units' ? r.units : r.revenue;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
    return [...totals.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit ?? 5);
  })
  .build();

const trendTool = fn('trend')
  .namespace('warehouse')
  .description('Monthly revenue series (Jan..Dec) for one region and product.')
  .arg('region', f.string())
  .arg('product', f.string())
  .returns(f.number('Revenue for each month, Jan..Dec').array())
  .handler(({ region, product }) => {
    const series = new Array(12).fill(0);
    for (const r of warehouse) {
      if (r.region === region && r.product === product)
        series[r.monthIndex] = r.revenue;
    }
    return series;
  })
  .build();

const analyst = agent(
  'schema:string, question:string -> answer:string, evidence:string[] "Concrete figures the answer is based on"',
  {
    runtime: new AxJSRuntime(),
    // Big data dictionary stays out of the prompt.
    contextFields: ['schema'],
    // Tools reach the data the prompt never sees.
    functions: [queryTool, topTool, trendTool],
    contextPolicy: {
      preset: 'lean',
      budget: 'balanced',
    },
    maxTurns: 40,
    executorOptions: {
      description: [
        'Consult the schema for column meaning and business rules.',
        'Answer using the warehouse tools — never invent figures.',
        'Group by region AND product when comparing. Cite concrete numbers as evidence.',
      ].join('\n'),
    },
  }
);

const result = await analyst.forward(llm, {
  schema,
  question:
    'Which region+product had the strongest Jan->Dec revenue growth, and which products have an average return rate above the 5% review threshold?',
});

console.log(JSON.stringify(result, null, 2));
