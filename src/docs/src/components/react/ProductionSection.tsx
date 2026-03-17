import { motion } from 'framer-motion';
import { GlowCard } from './GlowCard';
import {
  Activity,
  BarChart3,
  Zap,
  DollarSign,
  Globe,
  Shield,
} from 'lucide-react';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

/* ─── Stats ─── */

const stats = [
  { value: '1000+', label: 'Tests', color: 'text-blue-600 dark:text-blue-400' },
  {
    value: '40+',
    label: 'OTel Metrics',
    color: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    value: '15+',
    label: 'LLM Providers',
    color: 'text-purple-600 dark:text-purple-400',
  },
  {
    value: '3',
    label: 'Runtimes',
    color: 'text-emerald-600 dark:text-emerald-400',
  },
];

/* ─── Feature cards ─── */

const features = [
  {
    Icon: Activity,
    title: 'OpenTelemetry',
    description:
      'Full distributed tracing with spans per LLM call, function invocation, and agent turn. Drop-in Jaeger, Prometheus, or cloud exporters.',
    glow: 'rgba(59, 130, 246, 0.15)',
    color: 'blue',
  },
  {
    Icon: BarChart3,
    title: 'Detailed Metrics',
    description:
      'Token usage, latency histograms, error rates, context window utilization, and thinking budget tracking — all as OpenTelemetry metrics.',
    glow: 'rgba(34, 211, 238, 0.15)',
    color: 'cyan',
  },
  {
    Icon: Zap,
    title: 'Streaming & Validation',
    description:
      'End-to-end streaming with structured output validation. Auto-retries on schema failures with error correction built in.',
    glow: 'rgba(167, 139, 250, 0.15)',
    color: 'violet',
  },
  {
    Icon: DollarSign,
    title: 'Cost Tracking',
    description:
      'Per-request cost estimation across all providers. Budget monitoring, optimization insights, and cost allocation labels.',
    glow: 'rgba(52, 211, 153, 0.15)',
    color: 'emerald',
  },
  {
    Icon: Globe,
    title: 'Multi-Runtime',
    description:
      'Same code runs in Node.js, Deno, and browsers. Web Workers for sandboxed execution — deploy anywhere.',
    glow: 'rgba(99, 102, 241, 0.15)',
    color: 'indigo',
  },
  {
    Icon: Shield,
    title: 'Enterprise Ready',
    description:
      'Rate limiting, configurable sampling, content redaction, error handling with hindsight evaluation, and custom metric creation.',
    glow: 'rgba(244, 114, 182, 0.15)',
    color: 'pink',
  },
];

const iconColors: Record<string, { bg: string; text: string }> = {
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-500/20',
    text: 'text-blue-600 dark:text-blue-400',
  },
  cyan: {
    bg: 'bg-cyan-100 dark:bg-cyan-500/20',
    text: 'text-cyan-600 dark:text-cyan-400',
  },
  violet: {
    bg: 'bg-violet-100 dark:bg-violet-500/20',
    text: 'text-violet-600 dark:text-violet-400',
  },
  emerald: {
    bg: 'bg-emerald-100 dark:bg-emerald-500/20',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  indigo: {
    bg: 'bg-indigo-100 dark:bg-indigo-500/20',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
  pink: {
    bg: 'bg-pink-100 dark:bg-pink-500/20',
    text: 'text-pink-600 dark:text-pink-400',
  },
};

/* ─── Component ─── */

export default function ProductionSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      {/* Header */}
      <div className="text-center mb-16">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
          className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4"
        >
          Production-ready from day one
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto"
        >
          Extensive test coverage, full OpenTelemetry integration, cost
          tracking, and enterprise-grade error handling — built in, not bolted
          on.
        </motion.p>
      </div>

      {/* Stats row */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
        className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-14"
      >
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div
              className={`text-4xl md:text-5xl font-black tracking-tighter ${s.color} mb-1`}
            >
              {s.value}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {s.label}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Feature cards */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
      >
        {features.map((f, i) => {
          const c = iconColors[f.color];
          return (
            <GlowCard key={f.title} glowColor={f.glow} delay={i * 0.08}>
              <div className="p-6">
                <div
                  className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center mb-4`}
                >
                  <f.Icon className={`w-5 h-5 ${c.text}`} />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {f.description}
                </p>
              </div>
            </GlowCard>
          );
        })}
      </motion.div>

      {/* Link to telemetry docs */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
        className="text-center mt-12"
      >
        <a
          href="/telemetry"
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Explore telemetry &amp; metrics
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
    </section>
  );
}
