import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Brain, Zap } from 'lucide-react';
import { GlowCard } from './GlowCard';
import {
  getHomepageLanguageDemo,
  useHomepageLanguage,
} from './homepageLanguage';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

/* ─── Context growth comparison chart ─── */

function ContextGrowthChart() {
  const padL = 38;
  const padR = 50;
  const padT = 20;
  const padB = 28;
  const chartW = 260;
  const chartH = 130;
  const svgW = padL + chartW + padR;
  const svgH = padT + chartH + padB;

  const turns = 8;
  const xStep = chartW / (turns - 1);

  // simulated prompt-context tokens (0–1000 scale)
  const naive = [80, 220, 400, 570, 720, 840, 910, 960];
  const axagent = [80, 88, 85, 91, 86, 90, 87, 89];

  const toX = (i: number) => padL + i * xStep;
  const toY = (v: number) => padT + chartH - (v / 1000) * chartH;

  const naivePath = naive
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`
    )
    .join(' ');
  const axPath = axagent
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`
    )
    .join(' ');
  const naiveArea = `${naivePath} L${toX(turns - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;
  const axArea = `${axPath} L${toX(turns - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-900/80 p-5 shadow-xl">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">
            Prompt stays lean — across every turn
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            State lives in the runtime session, not the LLM context
          </p>
        </div>
        <div className="flex-shrink-0 ml-4 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          RLM
        </div>
      </div>

      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full"
        aria-hidden="true"
      >
        {/* Grid lines */}
        {[0, 250, 500, 750, 1000].map((v) => (
          <line
            key={v}
            x1={padL}
            y1={toY(v)}
            x2={padL + chartW}
            y2={toY(v)}
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeDasharray="2 3"
          />
        ))}
        {/* Y axis labels */}
        {[0, 500, 1000].map((v) => (
          <text
            key={v}
            x={padL - 5}
            y={toY(v) + 4}
            textAnchor="end"
            fontSize="8"
            fill="currentColor"
            opacity="0.35"
            fontFamily="Inter, monospace"
          >
            {v === 1000 ? '1k' : v === 500 ? '500' : '0'}
          </text>
        ))}
        {/* X axis: turn numbers */}
        {naive.map((_, i) => (
          <text
            key={i}
            x={toX(i)}
            y={svgH - 6}
            textAnchor="middle"
            fontSize="8"
            fill="currentColor"
            opacity="0.3"
            fontFamily="Inter, monospace"
          >
            {i + 1}
          </text>
        ))}

        {/* Naive area + line */}
        <path d={naiveArea} fill="rgb(239,68,68)" opacity="0.07" />
        <path
          d={naivePath}
          fill="none"
          stroke="rgb(239,68,68)"
          strokeWidth="1.5"
          strokeOpacity="0.5"
        />

        {/* Ax Agent area + line */}
        <path d={axArea} fill="rgb(52,211,153)" opacity="0.1" />
        <path
          d={axPath}
          fill="none"
          stroke="rgb(52,211,153)"
          strokeWidth="2.5"
        />

        {/* End-of-line dots + labels */}
        <circle
          cx={toX(turns - 1)}
          cy={toY(naive[turns - 1])}
          r="3"
          fill="rgb(239,68,68)"
          opacity="0.65"
        />
        <text
          x={toX(turns - 1) + 6}
          y={toY(naive[turns - 1]) + 4}
          fontSize="8.5"
          fill="rgb(239,68,68)"
          opacity="0.7"
          fontFamily="Inter, sans-serif"
        >
          naive
        </text>
        <circle
          cx={toX(turns - 1)}
          cy={toY(axagent[turns - 1])}
          r="3.5"
          fill="rgb(52,211,153)"
        />
        <text
          x={toX(turns - 1) + 6}
          y={toY(axagent[turns - 1]) + 4}
          fontSize="8.5"
          fill="rgb(52,211,153)"
          fontFamily="Inter, sans-serif"
          fontWeight="600"
        >
          ax
        </text>

        {/* Y axis label */}
        <text
          x={10}
          y={padT + chartH / 2}
          textAnchor="middle"
          fontSize="7.5"
          fill="currentColor"
          opacity="0.25"
          fontFamily="Inter, sans-serif"
          transform={`rotate(-90, 10, ${padT + chartH / 2})`}
        >
          ctx tokens
        </text>
      </svg>

      <div className="flex items-center gap-4 mt-1 pt-2 border-t border-gray-100 dark:border-white/5">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-px bg-red-400 opacity-60" />
          <span className="text-[10px] text-gray-400">Naive agent</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-emerald-400" />
          <span className="text-[10px] text-gray-400">Ax Agent (RLM)</span>
        </div>
        <span className="ml-auto text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          ≈10× less tokens
        </span>
      </div>
    </div>
  );
}

/* ─── Code Block ─── */

function AgentCodeBlock() {
  const language = useHomepageLanguage();
  const demo = getHomepageLanguageDemo(language).agent;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-[#1a1b26] overflow-hidden shadow-2xl">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
        <span className="ml-2 text-xs text-gray-500 font-mono">
          {demo.filename}
        </span>
      </div>

      <div className="p-5">
        <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-emerald-300/80 font-semibold">
          {demo.runtimeLabel}
        </div>
        <AnimatePresence mode="wait">
          <motion.pre
            key={`${language}-agent-code`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="font-mono text-[12.5px] leading-[1.85] text-gray-300 overflow-x-auto"
          >
            <code>{demo.code}</code>
          </motion.pre>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─── Feature cards ─── */

const features = [
  {
    Icon: Bot,
    title: 'State in the runtime, not the prompt',
    description:
      'Runtime sessions keep objects alive across turns. The LLM only sees a compact current-state summary — token cost stays flat no matter how long the loop runs.',
    color: 'emerald' as const,
    badges: ['RLM loop', 'Bounded context', 'Host runtime'],
  },
  {
    Icon: Zap,
    title: 'Typed signatures — end to end',
    description:
      "Declare agents as 'topic:string -> report:string'. Inputs and outputs follow the same Ax contract across native language packages.",
    color: 'violet' as const,
    badges: ['DSPy-style', 'Native packages', 'Schema validated'],
  },
  {
    Icon: Brain,
    title: 'Auto-optimized with DSPy + GEPA',
    description:
      'Few-shot examples are tuned automatically. GEPA finds the instruction set that maximizes accuracy across your evals — no manual prompt engineering required.',
    color: 'blue' as const,
    badges: ['GEPA', 'DSPy', 'Few-shot tuning'],
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
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/[0.02] dark:via-emerald-500/[0.03] to-transparent pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE }}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300 mb-5"
          >
            Ax Agent
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE }}
            className="text-3xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight mb-4"
          >
            DSPy + RLM agents that{' '}
            <span className="bg-gradient-to-r from-emerald-500 to-cyan-500 bg-clip-text text-transparent">
              actually work
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
            className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto"
          >
            Typed DSPy signatures, a secure JS runtime, and checkpointed context
            management — a full agent harness that keeps long-running loops
            stable without prompt bloat.
          </motion.p>
        </div>

        {/* Two-panel: code left, chart right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-stretch mb-16">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <AgentCodeBlock />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
          >
            <ContextGrowthChart />
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

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
          className="mt-12 flex flex-col items-center gap-4"
        >
          <a
            href="/ax-agent"
            className="inline-flex items-center gap-2.5 rounded-2xl bg-gray-900 dark:bg-emerald-600 px-8 py-4 text-base font-bold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:bg-gray-700 dark:hover:bg-emerald-500 hover:shadow-xl"
          >
            Explore Ax Agent — The Best DSPy + RLM Harness
            <svg
              className="w-5 h-5 shrink-0"
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
          <div className="flex items-center gap-3 text-sm">
            <a
              href="https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-agent.md"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
            >
              Read the guide
            </a>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <a
              href="https://github.com/ax-llm/ax/blob/main/src/ax/skills/ax-agent-optimize.md"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
            >
              Optimization guide
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
