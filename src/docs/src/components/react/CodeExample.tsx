import { AnimatePresence, motion } from 'framer-motion';
import {
  getHomepageLanguageDemo,
  useHomepageLanguage,
} from './homepageLanguage';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

export default function CodeExample() {
  const language = useHomepageLanguage();
  const demo = getHomepageLanguageDemo(language).classifier;

  return (
    <section
      id="get-started"
      className="max-w-6xl mx-auto px-6 py-16 scroll-mt-20"
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4">
            Simple &amp; Powerful
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Define what you want, not how to prompt for it
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Code input */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            <TerminalHeader filename={demo.filename} />
            <AnimatePresence mode="wait">
              <motion.pre
                key={`${language}-classifier-code`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="p-5 text-sm leading-relaxed overflow-x-auto font-mono text-gray-800 dark:text-gray-200"
              >
                <code>{demo.code}</code>
              </motion.pre>
            </AnimatePresence>
          </div>

          {/* Output */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            <TerminalHeader filename="output" />
            <div className="p-5 flex flex-col justify-center h-[calc(100%-48px)]">
              <AnimatePresence mode="wait">
                <motion.pre
                  key={`${language}-classifier-output`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="text-sm leading-relaxed font-mono text-gray-800 dark:text-gray-200"
                >
                  <code>{demo.output}</code>
                </motion.pre>
              </AnimatePresence>
              <div className="mt-8 flex items-center gap-3">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {demo.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function TerminalHeader({ filename }: { filename: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-white/10">
      <div className="flex gap-1.5">
        <div className="w-3 h-3 rounded-full bg-red-400" />
        <div className="w-3 h-3 rounded-full bg-yellow-400" />
        <div className="w-3 h-3 rounded-full bg-green-400" />
      </div>
      <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-mono">
        {filename}
      </span>
    </div>
  );
}
