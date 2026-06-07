import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import {
  getHomepageLanguageDemo,
  type SignatureTab,
  useHomepageLanguage,
} from './homepageLanguage';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;
const TABS: SignatureTab[] = ['native', 'string', 'schema'];
const FEATURE_COLORS = ['bg-emerald-500', 'bg-purple-500', 'bg-cyan-500'];

export default function SignatureShowcase() {
  const [tab, setTab] = useState<SignatureTab>('native');
  const language = useHomepageLanguage();
  const languageDemo = getHomepageLanguageDemo(language);
  const panel = languageDemo.signatures[tab];

  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4">
            One signature, native code
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            String signatures, fluent builders, and schema output share the same
            Ax semantics in every language package.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex rounded-xl bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 p-1">
            {TABS.map((item) => (
              <TabButton
                key={item}
                active={tab === item}
                onClick={() => setTab(item)}
                label={languageDemo.signatures[item].tabLabel}
              />
            ))}
          </div>
        </div>

        {/* Code panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left: Code input */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            <TerminalHeader filename={panel.filename} />
            <AnimatePresence mode="wait">
              <motion.pre
                key={`${language}-${tab}-code`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="p-5 text-[13px] leading-relaxed overflow-x-auto font-mono text-gray-800 dark:text-gray-200"
              >
                <code>{panel.code}</code>
              </motion.pre>
            </AnimatePresence>
          </div>

          {/* Right: Output */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            <TerminalHeader filename="output" />
            <AnimatePresence mode="wait">
              <motion.div
                key={`${language}-${tab}-output`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="p-5 flex flex-col h-[calc(100%-48px)]"
              >
                <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-3">
                  Typed Output
                </div>
                <pre className="text-[13px] leading-relaxed font-mono flex-1 text-gray-800 dark:text-gray-200 overflow-x-auto">
                  <code>{panel.output}</code>
                </pre>
                <div className="mt-4 space-y-2">
                  {panel.features.map((feature, index) => (
                    <Feature
                      key={feature}
                      color={FEATURE_COLORS[index % FEATURE_COLORS.length]}
                      text={feature}
                    />
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
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

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
        active
          ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );
}

function Feature({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-1.5 h-1.5 ${color} rounded-full`} />
      <span className="text-xs text-gray-500 dark:text-gray-400">{text}</span>
    </div>
  );
}
