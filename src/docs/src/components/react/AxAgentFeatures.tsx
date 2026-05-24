import { motion } from 'framer-motion';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.6, delay, ease: EASE },
});

const FEATURES = [
  {
    tag: 'Core',
    tagColor:
      'text-cyan-600 dark:text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
    title: 'Context Management',
    body: 'Use checkpointed, adaptive, lean, or full replay policies to keep long-running agents stable across hundreds of turns.',
  },
  {
    tag: 'Runtime',
    tagColor:
      'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    title: 'Model Upgrading',
    body: 'Escalate the actor model when the run gets noisy — without upgrading the whole stack all at once.',
  },
  {
    tag: 'Performance',
    tagColor:
      'text-fuchsia-600 dark:text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20',
    title: 'Cache Aware',
    body: 'Works naturally with prompt-cache-friendly patterns instead of fighting repeated multi-turn workloads.',
  },
  {
    tag: 'Memory',
    tagColor:
      'text-amber-600 dark:text-amber-300 bg-amber-500/10 border-amber-500/20',
    title: 'Context Map',
    body: 'Persist a compact orientation map for repeated long-context questions, then freeze it after a finite warmup when the cache is stable.',
  },
  {
    tag: 'Optimization',
    tagColor:
      'text-violet-600 dark:text-violet-300 bg-violet-500/10 border-violet-500/20',
    title: 'DSPy + GEPA Ready',
    body: 'DSPy-style typed signatures, optimization workflows, and GEPA end-to-end tuning built into the Ax system.',
  },
];

export default function AxAgentFeatures() {
  return (
    <section className="relative bg-white px-6 py-8 dark:bg-slate-950 md:px-10 lg:px-12 lg:py-12">
      <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-2 xl:grid-cols-5">
        {FEATURES.map((item, index) => (
          <motion.div
            key={item.title}
            {...fadeUp(index * 0.05)}
            className="rounded-[1.6rem] border border-slate-200/80 bg-white/85 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-white/[0.04]"
          >
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${item.tagColor}`}
            >
              {item.tag}
            </span>
            <div className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">
              {item.title}
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {item.body}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
