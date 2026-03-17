import type React from 'react';
import { motion } from 'framer-motion';
import { Zap, Shield, Activity, RefreshCcw } from 'lucide-react';
import { GlowCard } from './GlowCard';

/* ─── Inline SVG visualizations ─── */

function ParetoFrontierSVG() {
  return (
    <svg
      viewBox="0 0 140 90"
      className="w-full max-w-[180px] h-auto"
      aria-hidden="true"
    >
      {/* Axes */}
      <line
        x1="18"
        y1="5"
        x2="18"
        y2="75"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />
      <line
        x1="18"
        y1="75"
        x2="130"
        y2="75"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />
      {/* Axis labels */}
      <text
        x="70"
        y="88"
        textAnchor="middle"
        className="fill-gray-400 dark:fill-gray-500"
        fontSize="8"
        fontFamily="Inter, sans-serif"
      >
        accuracy → speed
      </text>

      {/* Pareto curve */}
      <path
        d="M24,12 Q45,18 60,35 Q78,52 125,65"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3,3"
        opacity="0.25"
      />

      {/* Pareto-optimal points */}
      <circle cx="26" cy="14" r="4" className="fill-pink-500" opacity="0.8" />
      <circle cx="50" cy="27" r="4" className="fill-purple-500" opacity="0.8" />
      <circle cx="78" cy="47" r="4" className="fill-cyan-500" opacity="0.8" />
      <circle cx="115" cy="63" r="4" className="fill-blue-500" opacity="0.8" />

      {/* Dominated point (dimmer) */}
      <circle cx="65" cy="58" r="3" className="fill-gray-400" opacity="0.2" />
      <circle cx="45" cy="50" r="3" className="fill-gray-400" opacity="0.2" />
    </svg>
  );
}

function RecursiveLoopSVG() {
  return (
    <svg
      viewBox="0 0 140 90"
      className="w-full max-w-[180px] h-auto"
      aria-hidden="true"
    >
      {/* Concentric arcs */}
      <path
        d="M70,70 A30,30 0 0,1 40,40"
        fill="none"
        className="stroke-violet-400 dark:stroke-violet-500"
        strokeWidth="1.5"
        opacity="0.6"
        strokeLinecap="round"
      />
      <path
        d="M70,75 A38,38 0 0,1 32,37"
        fill="none"
        className="stroke-violet-300 dark:stroke-violet-600"
        strokeWidth="1.5"
        opacity="0.4"
        strokeLinecap="round"
      />
      <path
        d="M70,80 A46,46 0 0,1 24,34"
        fill="none"
        className="stroke-violet-200 dark:stroke-violet-700"
        strokeWidth="1.5"
        opacity="0.25"
        strokeLinecap="round"
      />

      {/* Arrow heads on arcs */}
      <polygon
        points="38,38 44,42 42,36"
        className="fill-violet-400 dark:fill-violet-500"
        opacity="0.6"
      />
      <polygon
        points="30,35 36,39 34,33"
        className="fill-violet-300 dark:fill-violet-600"
        opacity="0.4"
      />

      {/* Center node */}
      <circle
        cx="70"
        cy="45"
        r="8"
        className="fill-violet-500 dark:fill-violet-400"
        opacity="0.8"
      />
      <circle cx="70" cy="45" r="4" className="fill-white dark:fill-gray-900" />

      {/* Flow labels */}
      <text
        x="90"
        y="30"
        className="fill-gray-400 dark:fill-gray-500"
        fontSize="7"
        fontFamily="Inter, sans-serif"
      >
        Analyze
      </text>
      <text
        x="95"
        y="50"
        className="fill-gray-400 dark:fill-gray-500"
        fontSize="7"
        fontFamily="Inter, sans-serif"
      >
        Refine
      </text>
      <text
        x="88"
        y="70"
        className="fill-gray-400 dark:fill-gray-500"
        fontSize="7"
        fontFamily="Inter, sans-serif"
      >
        Synthesize
      </text>

      {/* Dots next to labels */}
      <circle cx="86" cy="27" r="2" className="fill-violet-400" opacity="0.6" />
      <circle cx="91" cy="47" r="2" className="fill-violet-400" opacity="0.6" />
      <circle cx="84" cy="67" r="2" className="fill-violet-400" opacity="0.6" />
    </svg>
  );
}

function AgentTreeSVG() {
  return (
    <svg
      viewBox="0 0 140 90"
      className="w-full max-w-[180px] h-auto"
      aria-hidden="true"
    >
      {/* Connection lines */}
      <line
        x1="70"
        y1="18"
        x2="35"
        y2="48"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />
      <line
        x1="70"
        y1="18"
        x2="105"
        y2="48"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />
      <line
        x1="35"
        y1="48"
        x2="18"
        y2="75"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />
      <line
        x1="35"
        y1="48"
        x2="52"
        y2="75"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />
      <line
        x1="105"
        y1="48"
        x2="105"
        y2="75"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />

      {/* Root agent */}
      <circle
        cx="70"
        cy="18"
        r="7"
        className="fill-emerald-500"
        opacity="0.8"
      />
      <text
        x="70"
        y="21"
        textAnchor="middle"
        className="fill-white"
        fontSize="7"
        fontWeight="bold"
      >
        A
      </text>

      {/* Child agents */}
      <circle
        cx="35"
        cy="48"
        r="6"
        className="fill-emerald-400"
        opacity="0.8"
      />
      <text
        x="35"
        y="51"
        textAnchor="middle"
        className="fill-white"
        fontSize="6"
        fontWeight="bold"
      >
        A
      </text>

      <circle cx="105" cy="48" r="6" className="fill-amber-500" opacity="0.8" />
      <text
        x="105"
        y="51"
        textAnchor="middle"
        className="fill-white"
        fontSize="6"
        fontWeight="bold"
      >
        T
      </text>

      {/* Grandchildren */}
      <circle
        cx="18"
        cy="75"
        r="5"
        className="fill-emerald-300"
        opacity="0.7"
      />
      <text
        x="18"
        y="78"
        textAnchor="middle"
        className="fill-white"
        fontSize="5"
        fontWeight="bold"
      >
        A
      </text>

      <circle cx="52" cy="75" r="5" className="fill-amber-400" opacity="0.7" />
      <text
        x="52"
        y="78"
        textAnchor="middle"
        className="fill-white"
        fontSize="5"
        fontWeight="bold"
      >
        T
      </text>

      <circle cx="105" cy="75" r="5" className="fill-amber-400" opacity="0.7" />
      <text
        x="105"
        y="78"
        textAnchor="middle"
        className="fill-white"
        fontSize="5"
        fontWeight="bold"
      >
        T
      </text>

      {/* Legend */}
      <circle
        cx="125"
        cy="18"
        r="3"
        className="fill-emerald-500"
        opacity="0.6"
      />
      <text
        x="132"
        y="21"
        className="fill-gray-400 dark:fill-gray-500"
        fontSize="7"
        fontFamily="Inter, sans-serif"
      >
        Agent
      </text>
      <circle cx="125" cy="30" r="3" className="fill-amber-500" opacity="0.6" />
      <text
        x="132"
        y="33"
        className="fill-gray-400 dark:fill-gray-500"
        fontSize="7"
        fontFamily="Inter, sans-serif"
      >
        Tool
      </text>
    </svg>
  );
}

/* ─── Highlights data ─── */

interface Highlight {
  stat: string;
  statGradient?: boolean;
  title: string;
  description: string;
  glowColor: string;
  statColor: string;
  visual: React.ReactNode;
}

const highlights: Highlight[] = [
  {
    stat: 'Battle-tested',
    title: 'Production-Ready',
    description:
      'Streaming, validation with auto-retry, OpenTelemetry observability, structured error handling.',
    glowColor: 'rgba(52, 211, 153, 0.15)',
    statColor: 'text-emerald-600 dark:text-emerald-400',
    visual: (
      <div className="flex items-center gap-3 mt-1">
        {[
          { Icon: Zap, label: 'Streaming' },
          { Icon: Shield, label: 'Validation' },
          { Icon: Activity, label: 'Telemetry' },
          { Icon: RefreshCcw, label: 'Auto-retry' },
        ].map(({ Icon, label }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
              <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-[9px] text-gray-400 dark:text-gray-500">
              {label}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    stat: '0',
    statGradient: true,
    title: 'Dependencies',
    description:
      'Only 2 optional peer deps (OpenTelemetry + dayjs). Your bundle stays lean.',
    glowColor: 'rgba(34, 211, 238, 0.15)',
    statColor: '',
    visual: null,
  },
  {
    stat: '3 Runtimes',
    title: 'Universal Runtime',
    description:
      'Works in Node.js, Deno, and browsers. Web Workers for sandboxed execution.',
    glowColor: 'rgba(59, 130, 246, 0.15)',
    statColor: 'text-blue-600 dark:text-blue-400',
    visual: (
      <div className="flex items-center gap-2 mt-1">
        {['Node.js', 'Deno', 'Browser'].map((rt) => (
          <span
            key={rt}
            className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20"
          >
            {rt}
          </span>
        ))}
      </div>
    ),
  },
  {
    stat: 'Multi-Objective',
    title: 'GEPA Optimizer',
    description:
      'Returns Pareto frontiers — balance accuracy vs speed vs cost. Pick the optimal trade-off.',
    glowColor: 'rgba(244, 114, 182, 0.15)',
    statColor: 'text-pink-600 dark:text-pink-400',
    visual: <ParetoFrontierSVG />,
  },
  {
    stat: 'Deep Context',
    title: 'Recursive Language Model',
    description:
      'Long-context analysis with persistent sessions and iterative refinement. Keeps long context out of root prompt.',
    glowColor: 'rgba(167, 139, 250, 0.15)',
    statColor: 'text-violet-600 dark:text-violet-400',
    visual: <RecursiveLoopSVG />,
  },
  {
    stat: 'Autonomous',
    title: 'AxAgent',
    description:
      'ReAct loops, tool calling, child agents, context policies, dynamic function discovery.',
    glowColor: 'rgba(52, 211, 153, 0.15)',
    statColor: 'text-emerald-600 dark:text-emerald-400',
    visual: <AgentTreeSVG />,
  },
];

/* ─── Container animation ─── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

/* ─── Component ─── */

export default function HighlightsSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-16">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{
            duration: 0.6,
            ease: [0.25, 0.46, 0.45, 0.94] as const,
          }}
          className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4"
        >
          Why teams choose Ax
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{
            duration: 0.6,
            delay: 0.1,
            ease: [0.25, 0.46, 0.45, 0.94] as const,
          }}
          className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto"
        >
          Built for production from day one
        </motion.p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
      >
        {highlights.map((h, i) => (
          <GlowCard
            key={h.title}
            glowColor={h.glowColor}
            delay={i * 0.1}
            className="min-h-[260px]"
          >
            <div className="p-6 md:p-7 flex flex-col h-full">
              {/* Stat callout */}
              {h.statGradient ? (
                <div className="text-6xl md:text-7xl font-black mb-2 tracking-tighter animate-stat-pulse bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500 bg-clip-text text-transparent">
                  {h.stat}
                </div>
              ) : (
                <div
                  className={`text-3xl md:text-4xl font-black ${h.statColor} mb-2 tracking-tight`}
                >
                  {h.stat}
                </div>
              )}

              {/* Title */}
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {h.title}
              </h3>

              {/* Description */}
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4 flex-1">
                {h.description}
              </p>

              {/* Visual element */}
              {h.visual && <div className="mt-auto">{h.visual}</div>}
            </div>
          </GlowCard>
        ))}
      </motion.div>
    </section>
  );
}
