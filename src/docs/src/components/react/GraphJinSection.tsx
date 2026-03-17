import { motion } from 'framer-motion';
import { Database, Plug } from 'lucide-react';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const databases = [
  { name: 'PostgreSQL', color: 'text-blue-600 dark:text-blue-400' },
  { name: 'MySQL', color: 'text-orange-600 dark:text-orange-400' },
  { name: 'SQLite', color: 'text-sky-600 dark:text-sky-400' },
  { name: 'MongoDB', color: 'text-emerald-600 dark:text-emerald-400' },
  { name: 'Oracle', color: 'text-red-600 dark:text-red-400' },
  { name: 'MSSQL', color: 'text-purple-600 dark:text-purple-400' },
  { name: 'Snowflake', color: 'text-cyan-600 dark:text-cyan-400' },
];

const axIntegration = `import {
  AxAI, AxAgent, AxMCPClient,
  AxMCPHTTPSSETransport
} from '@ax-llm/ax';

// Connect to GraphJin's MCP server
const transport = new AxMCPHTTPSSETransport(
  'http://localhost:8080/api/v1/mcp'
);
const mcp = new AxMCPClient(transport);
await mcp.init();

// Use GraphJin tools in an Ax agent
const agent = new AxAgent({
  name: 'data-analyst',
  description: 'Queries databases',
  signature: 'question:string -> answer:string',
  functions: mcp.toFunction(),
});`;

export default function GraphJinSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      {/* Header */}
      <div className="text-center mb-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium mb-5"
        >
          <Database className="w-3.5 h-3.5" />
          Also Checkout
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.05, ease: EASE }}
          className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4"
        >
          Connect AI to your database
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto"
        >
          <a
            href="https://graphjin.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
          >
            GraphJin
          </a>{' '}
          compiles GraphQL to efficient SQL and doubles as an MCP server —
          giving Claude Desktop and Ax agents direct, safe access to your data.
        </motion.p>
      </div>

      {/* Ax integration code block */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.6, ease: EASE }}
        className="max-w-2xl mx-auto mb-10"
      >
        <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-[#1a1b26]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
            </div>
            <span className="text-[11px] font-mono text-gray-500 ml-2">
              ax-agent.ts
            </span>
            <Plug className="w-3 h-3 text-gray-600 ml-auto" />
          </div>
          <pre className="p-4 text-[13px] font-mono leading-relaxed text-gray-300 overflow-x-auto">
            <code>{axIntegration}</code>
          </pre>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 text-center">
          Connect GraphJin as an MCP tool inside Ax agents
        </p>
      </motion.div>

      {/* Supported databases */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
        className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
      >
        <span className="text-sm text-gray-400 dark:text-gray-500">
          Works with
        </span>
        {databases.map((db) => (
          <span key={db.name} className={`text-sm font-semibold ${db.color}`}>
            {db.name}
          </span>
        ))}
      </motion.div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
        className="text-center mt-12 flex flex-col sm:flex-row items-center justify-center gap-4"
      >
        <a
          href="https://graphjin.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
        >
          Explore GraphJin
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M17 8l4 4m0 0l-4 4m4-4H3"
            />
          </svg>
        </a>
        <span className="text-gray-300 dark:text-gray-600 hidden sm:inline">
          |
        </span>
        <a
          href="https://github.com/dosco/graphjin"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          GitHub
        </a>
      </motion.div>
    </section>
  );
}
