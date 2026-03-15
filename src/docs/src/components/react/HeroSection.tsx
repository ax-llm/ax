import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import NetworkCanvas from './NetworkCanvas';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: EASE },
});

const INSTALL_COMMANDS = [
  { cmd: 'npm install @ax-llm/ax', label: 'npm' },
  { cmd: 'npx ax', label: 'npx' },
  { cmd: 'deno add npm:@ax-llm/ax --allow-scripts', label: 'deno' },
  { cmd: 'bun add @ax-llm/ax', label: 'bun' },
];

export default function HeroSection() {
  const [copied, setCopied] = useState(false);
  const [cmdIndex, setCmdIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCmdIndex((i) => (i + 1) % INSTALL_COMMANDS.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(INSTALL_COMMANDS[cmdIndex].cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [cmdIndex]);

  return (
    <section className="relative min-h-[95vh] flex items-start justify-center overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0">
        {/* Dot grid pattern */}
        <div className="absolute inset-0 dot-grid opacity-[0.03] dark:opacity-[0.05]" />

        {/* Animated network canvas */}
        <NetworkCanvas />

        {/* Decorative gradient orbs */}
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-500/10 dark:bg-blue-500/[0.07] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-purple-500/10 dark:bg-purple-500/[0.07] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-2/3 left-1/3 w-64 h-64 bg-cyan-500/[0.06] dark:bg-cyan-500/[0.04] rounded-full blur-3xl pointer-events-none" />

        {/* Background image — full brightness, sits behind the top fade */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat z-[1]"
          style={{ backgroundImage: "url('/bg1.webp')" }}
        />

        {/* Top fade: page background covers the text zone, fades to reveal image below */}
        <div className="absolute inset-x-0 top-0 h-[75%] bg-gradient-to-b from-white via-white to-transparent dark:from-gray-900 dark:via-gray-900 z-[2]" />

        {/* Bottom fade into next section */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white dark:from-gray-900 to-transparent z-[2]" />
      </div>

      {/* Content — sits in the clean top zone */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 pt-28 pb-16 text-center">
        {/* Tagline */}
        <motion.h1
          {...fadeUp(0)}
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold leading-[1.05] text-gray-900 dark:text-white tracking-tighter mb-6"
        >
          <span className="relative inline-block">
            {/* Glow layer (dark mode only) */}
            <span
              className="absolute inset-0 bg-clip-text text-transparent animate-gradient blur-2xl opacity-0 dark:opacity-40 pointer-events-none select-none"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #6366f1, #a855f7, #22d3ee, #10b981, #8b5cf6)',
              }}
              aria-hidden="true"
            >
              DSPy for TypeScript
            </span>
            {/* Visible gradient text */}
            <span
              className="relative bg-clip-text text-transparent animate-gradient"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #818cf8, #a855f7, #22d3ee, #34d399, #8b5cf6)',
              }}
            >
              DSPy for TypeScript
            </span>
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          {...fadeUp(0.1)}
          className="text-lg md:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto mb-6 leading-relaxed"
        >
          Declare signatures, not prompts. Ax compiles type-safe inputs and
          outputs into optimized LLM calls — then chains them into agents,
          flows, and self-improving pipelines.
        </motion.p>

        {/* Feature pills */}
        <motion.div
          {...fadeUp(0.2)}
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mb-8"
        >
          {[
            { label: '15+ LLM Providers', color: 'bg-blue-500' },
            { label: 'End-to-end Streaming', color: 'bg-purple-500' },
            { label: 'Auto Prompt Tuning', color: 'bg-cyan-500' },
            {
              label: 'Auto-installs Claude & Codex skills',
              color: 'bg-emerald-500',
            },
          ].map((pill) => (
            <div key={pill.label} className="flex items-center gap-2">
              <div className={`w-2 h-2 ${pill.color} rounded-full`} />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {pill.label}
              </span>
            </div>
          ))}
        </motion.div>

        {/* Install command — glassmorphism, cycling */}
        <motion.div {...fadeUp(0.3)} className="mb-6">
          <div className="inline-flex items-center gap-3 bg-white/60 dark:bg-white/[0.08] backdrop-blur-xl border border-gray-200/60 dark:border-white/10 rounded-xl px-5 py-3 font-mono text-sm shadow-lg shadow-gray-200/50 dark:shadow-none">
            <span className="text-gray-400 dark:text-gray-500 select-none">
              $
            </span>
            <div className="relative h-5 flex items-center overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.span
                  key={cmdIndex}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="text-gray-800 dark:text-gray-200 whitespace-nowrap"
                >
                  {INSTALL_COMMANDS[cmdIndex].cmd}
                </motion.span>
              </AnimatePresence>
            </div>
            <button
              onClick={handleCopy}
              className="ml-2 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-white/10 transition-colors"
              aria-label="Copy install command"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </motion.div>

        {/* CTA buttons */}
        <motion.div
          {...fadeUp(0.4)}
          className="flex flex-wrap items-center justify-center gap-4 mb-6"
        >
          <a
            href="#get-started"
            className="inline-flex items-center px-8 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 text-white font-semibold text-base hover:shadow-lg hover:shadow-purple-500/25 transition-all duration-300"
          >
            Get Started
          </a>
          <a
            href="https://github.com/ax-llm/ax"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/60 dark:bg-white/[0.08] backdrop-blur-xl border border-gray-200/60 dark:border-white/15 text-gray-700 dark:text-gray-300 font-semibold text-sm hover:bg-white/80 dark:hover:bg-white/[0.12] transition-all"
          >
            <svg
              className="w-5 h-5"
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

        {/* Badges */}
        <motion.div
          {...fadeUp(0.5)}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <a
            href="https://github.com/ax-llm/ax"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:scale-105 transition-transform"
          >
            <img
              src="https://img.shields.io/github/stars/ax-llm/ax?style=for-the-badge&logo=github&logoColor=white&color=black&labelColor=555"
              alt="GitHub Stars"
              className="h-7 rounded-md"
            />
          </a>
          <a
            href="https://www.npmjs.com/package/@ax-llm/ax"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:scale-105 transition-transform"
          >
            <img
              src="https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&logo=npm&logoColor=white&color=CC3534&labelColor=555"
              alt="NPM Package"
              className="h-7 rounded-md"
            />
          </a>
          <a
            href="https://twitter.com/dosco"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:scale-105 transition-transform"
          >
            <img
              src="https://img.shields.io/twitter/follow/dosco?style=for-the-badge&logo=twitter&logoColor=white&color=1DA1F2&labelColor=555"
              alt="Twitter Follow"
              className="h-7 rounded-md"
            />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
