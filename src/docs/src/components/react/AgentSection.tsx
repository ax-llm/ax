import { motion } from 'framer-motion';
import { GlowCard } from './GlowCard';
import { Bot, Brain, GitBranch } from 'lucide-react';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

/* ─── Animated Agent Tree SVG ─── */

function AgentTreeVisualization() {
  return (
    <svg
      viewBox="0 0 400 200"
      className="w-full h-auto max-w-md mx-auto"
      aria-hidden="true"
    >
      {/* Animated pulse along connections */}
      <defs>
        <linearGradient id="ag-pulse" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgb(52, 211, 153)" stopOpacity="0" />
          <stop offset="50%" stopColor="rgb(52, 211, 153)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="rgb(52, 211, 153)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ag-pulse-v" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgb(167, 139, 250)" stopOpacity="0" />
          <stop offset="50%" stopColor="rgb(167, 139, 250)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="rgb(167, 139, 250)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Connection lines */}
      <line
        x1="200"
        y1="55"
        x2="80"
        y2="120"
        className="stroke-gray-300 dark:stroke-white/10"
        strokeWidth="1.5"
      />
      <line
        x1="200"
        y1="55"
        x2="200"
        y2="120"
        className="stroke-gray-300 dark:stroke-white/10"
        strokeWidth="1.5"
      />
      <line
        x1="200"
        y1="55"
        x2="320"
        y2="120"
        className="stroke-gray-300 dark:stroke-white/10"
        strokeWidth="1.5"
      />

      {/* Leaf connections */}
      <line
        x1="80"
        y1="140"
        x2="40"
        y2="180"
        className="stroke-gray-300 dark:stroke-white/10"
        strokeWidth="1"
      />
      <line
        x1="80"
        y1="140"
        x2="120"
        y2="180"
        className="stroke-gray-300 dark:stroke-white/10"
        strokeWidth="1"
      />
      <line
        x1="320"
        y1="140"
        x2="320"
        y2="180"
        className="stroke-gray-300 dark:stroke-white/10"
        strokeWidth="1"
      />

      {/* Animated pulses on connections */}
      <circle r="3" className="fill-emerald-400" opacity="0.8">
        <animateMotion
          dur="2s"
          repeatCount="indefinite"
          path="M200,55 L80,120"
        />
      </circle>
      <circle r="3" className="fill-violet-400" opacity="0.8">
        <animateMotion
          dur="2.5s"
          repeatCount="indefinite"
          path="M200,55 L200,120"
        />
      </circle>
      <circle r="3" className="fill-emerald-400" opacity="0.8">
        <animateMotion
          dur="3s"
          repeatCount="indefinite"
          path="M200,55 L320,120"
        />
      </circle>

      {/* Root Agent node */}
      <g>
        <rect
          x="160"
          y="20"
          width="80"
          height="36"
          rx="10"
          className="fill-emerald-500"
          opacity="0.9"
        />
        <text
          x="200"
          y="43"
          textAnchor="middle"
          className="fill-white"
          fontSize="12"
          fontWeight="600"
          fontFamily="Inter, system-ui, sans-serif"
        >
          AxAgent
        </text>
      </g>

      {/* Child: Research Agent */}
      <g>
        <rect
          x="40"
          y="112"
          width="80"
          height="32"
          rx="8"
          className="fill-emerald-400"
          opacity="0.8"
        />
        <text
          x="80"
          y="133"
          textAnchor="middle"
          className="fill-white"
          fontSize="10"
          fontWeight="500"
          fontFamily="Inter, system-ui, sans-serif"
        >
          Researcher
        </text>
      </g>

      {/* Child: RLM Runtime */}
      <g>
        <rect
          x="158"
          y="112"
          width="84"
          height="32"
          rx="8"
          className="fill-violet-500"
          opacity="0.85"
        />
        <text
          x="200"
          y="133"
          textAnchor="middle"
          className="fill-white"
          fontSize="10"
          fontWeight="500"
          fontFamily="Inter, system-ui, sans-serif"
        >
          RLM Runtime
        </text>
      </g>

      {/* Child: Writer Agent */}
      <g>
        <rect
          x="280"
          y="112"
          width="80"
          height="32"
          rx="8"
          className="fill-emerald-400"
          opacity="0.8"
        />
        <text
          x="320"
          y="133"
          textAnchor="middle"
          className="fill-white"
          fontSize="10"
          fontWeight="500"
          fontFamily="Inter, system-ui, sans-serif"
        >
          Writer
        </text>
      </g>

      {/* Leaf: search function */}
      <g>
        <rect
          x="12"
          y="172"
          width="56"
          height="24"
          rx="6"
          className="fill-amber-500"
          opacity="0.7"
        />
        <text
          x="40"
          y="188"
          textAnchor="middle"
          className="fill-white"
          fontSize="9"
          fontWeight="500"
          fontFamily="Inter, system-ui, sans-serif"
        >
          search
        </text>
      </g>

      {/* Leaf: scrape function */}
      <g>
        <rect
          x="92"
          y="172"
          width="56"
          height="24"
          rx="6"
          className="fill-amber-500"
          opacity="0.7"
        />
        <text
          x="120"
          y="188"
          textAnchor="middle"
          className="fill-white"
          fontSize="9"
          fontWeight="500"
          fontFamily="Inter, system-ui, sans-serif"
        >
          scrape
        </text>
      </g>

      {/* Leaf: publish function */}
      <g>
        <rect
          x="292"
          y="172"
          width="56"
          height="24"
          rx="6"
          className="fill-amber-500"
          opacity="0.7"
        />
        <text
          x="320"
          y="188"
          textAnchor="middle"
          className="fill-white"
          fontSize="9"
          fontWeight="500"
          fontFamily="Inter, system-ui, sans-serif"
        >
          publish
        </text>
      </g>

      {/* Legend */}
      <g transform="translate(0, 0)">
        <circle
          cx="10"
          cy="10"
          r="4"
          className="fill-emerald-500"
          opacity="0.8"
        />
        <text
          x="18"
          y="14"
          className="fill-gray-400 dark:fill-gray-500"
          fontSize="9"
          fontFamily="Inter, system-ui, sans-serif"
        >
          Agent
        </text>
        <circle
          cx="60"
          cy="10"
          r="4"
          className="fill-violet-500"
          opacity="0.8"
        />
        <text
          x="68"
          y="14"
          className="fill-gray-400 dark:fill-gray-500"
          fontSize="9"
          fontFamily="Inter, system-ui, sans-serif"
        >
          RLM
        </text>
        <circle
          cx="100"
          cy="10"
          r="4"
          className="fill-amber-500"
          opacity="0.7"
        />
        <text
          x="108"
          y="14"
          className="fill-gray-400 dark:fill-gray-500"
          fontSize="9"
          fontFamily="Inter, system-ui, sans-serif"
        >
          Function
        </text>
      </g>
    </svg>
  );
}

/* ─── Code Block ─── */

function AgentCodeBlock() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-[#1a1b26] overflow-hidden shadow-2xl">
      {/* Terminal header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
        <span className="ml-2 text-xs text-gray-500 font-mono">agent.ts</span>
      </div>

      <div className="p-5 font-mono text-[13px] leading-[1.8] text-gray-300">
        <div className="text-gray-500">
          {'// Define an autonomous research agent'}
        </div>
        <div>
          <span className="text-purple-400">const</span>{' '}
          <span className="text-white">researcher</span>{' '}
          <span className="text-gray-500">=</span>{' '}
          <span className="text-blue-400">agent</span>
          <span className="text-gray-500">{'({'}</span>
        </div>
        <div className="pl-4">
          <span className="text-gray-300">name</span>
          <span className="text-gray-500">: </span>
          <span className="text-emerald-400">{"'researcher'"}</span>
          <span className="text-gray-500">,</span>
        </div>
        <div className="pl-4">
          <span className="text-gray-300">description</span>
          <span className="text-gray-500">: </span>
          <span className="text-emerald-400">{"'Deep research agent'"}</span>
          <span className="text-gray-500">,</span>
        </div>
        <div className="pl-4">
          <span className="text-gray-300">signature</span>
          <span className="text-gray-500">: </span>
          <span className="text-emerald-400">{"'query -> report'"}</span>
          <span className="text-gray-500">,</span>
        </div>
        <div className="pl-4">
          <span className="text-gray-300">functions</span>
          <span className="text-gray-500">: [</span>
          <span className="text-white">search</span>
          <span className="text-gray-500">, </span>
          <span className="text-white">scrape</span>
          <span className="text-gray-500">, </span>
          <span className="text-white">summarize</span>
          <span className="text-gray-500">],</span>
        </div>
        <div className="pl-4">
          <span className="text-gray-300">agents</span>
          <span className="text-gray-500">: [</span>
          <span className="text-white">factChecker</span>
          <span className="text-gray-500">, </span>
          <span className="text-white">writer</span>
          <span className="text-gray-500">],</span>
        </div>
        <div className="pl-4">
          <span className="text-gray-300">contextPolicy</span>
          <span className="text-gray-500">: </span>
          <span className="text-emerald-400">{"'adaptive'"}</span>
          <span className="text-gray-500">,</span>
        </div>
        <div>
          <span className="text-gray-500">{'})'}</span>
        </div>

        <div className="mt-3 text-gray-500">
          {'// Agent runs autonomously with RLM'}
        </div>
        <div>
          <span className="text-purple-400">const</span>{' '}
          <span className="text-white">result</span>{' '}
          <span className="text-gray-500">=</span>{' '}
          <span className="text-purple-400">await</span>{' '}
          <span className="text-white">researcher.</span>
          <span className="text-blue-400">forward</span>
          <span className="text-gray-500">(</span>
          <span className="text-white">llm</span>
          <span className="text-gray-500">, {'{'}</span>
        </div>
        <div className="pl-4">
          <span className="text-gray-300">query</span>
          <span className="text-gray-500">: </span>
          <span className="text-emerald-400">
            {"'Compare React vs Vue in 2025'"}
          </span>
        </div>
        <div>
          <span className="text-gray-500">{'})'}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Feature cards ─── */

const features = [
  {
    Icon: Bot,
    title: 'ReAct Loops & RLM',
    description:
      'Multi-turn autonomous reasoning with a persistent JavaScript sandbox. State survives across turns — long context stays out of the root prompt.',
    color: 'emerald' as const,
    badges: ['Multi-turn', 'Persistent state', 'Sandboxed JS'],
  },
  {
    Icon: GitBranch,
    title: 'Hierarchical Agents',
    description:
      'Delegate subtasks to child agents with shared state and namespaced functions. Discover tools at runtime — the agent picks what it needs.',
    color: 'violet' as const,
    badges: ['Child agents', 'Shared state', 'Namespaces'],
  },
  {
    Icon: Brain,
    title: 'Adaptive Context',
    description:
      'Choose full, adaptive, or lean memory policies. Old context compresses into checkpoint summaries automatically, keeping prompts focused.',
    color: 'blue' as const,
    badges: ['3 policies', 'Auto-compress', 'Checkpoints'],
  },
];

const colorMap = {
  emerald: {
    bg: 'bg-emerald-100 dark:bg-emerald-500/20',
    text: 'text-emerald-600 dark:text-emerald-400',
    glow: 'rgba(52, 211, 153, 0.15)',
    badge:
      'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  },
  violet: {
    bg: 'bg-violet-100 dark:bg-violet-500/20',
    text: 'text-violet-600 dark:text-violet-400',
    glow: 'rgba(167, 139, 250, 0.15)',
    badge:
      'bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-500/20',
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-500/20',
    text: 'text-blue-600 dark:text-blue-400',
    glow: 'rgba(59, 130, 246, 0.15)',
    badge:
      'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
  },
};

/* ─── Component ─── */

export default function AgentSection() {
  return (
    <section className="relative py-24 overflow-hidden">
      {/* Subtle background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/[0.02] dark:via-emerald-500/[0.03] to-transparent pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE }}
            className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4"
          >
            Autonomous agents, built in
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
            className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto"
          >
            AxAgent combines ReAct reasoning with a recursive language model — a
            persistent JavaScript sandbox that keeps long context out of the
            root prompt.
          </motion.p>
        </div>

        {/* Two-panel: code left, visualization right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center mb-16">
          {/* Left — dark code block */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <AgentCodeBlock />
          </motion.div>

          {/* Right — agent tree visualization */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
            className="flex flex-col items-center"
          >
            <AgentTreeVisualization />
          </motion.div>
        </div>

        {/* Three feature cards */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5"
        >
          {features.map((f, i) => {
            const c = colorMap[f.color];
            return (
              <GlowCard key={f.title} glowColor={c.glow} delay={i * 0.1}>
                <div className="p-6">
                  <div
                    className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center mb-4`}
                  >
                    <f.Icon className={`w-5 h-5 ${c.text}`} />
                  </div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">
                    {f.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                    {f.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {f.badges.map((b) => (
                      <span
                        key={b}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${c.badge}`}
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              </GlowCard>
            );
          })}
        </motion.div>

        {/* Link to guide */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
          className="text-center mt-12"
        >
          <a
            href="https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-agent.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
          >
            Read the AxAgent Guide
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
        </motion.div>
      </div>
    </section>
  );
}
