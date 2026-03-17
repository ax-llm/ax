import type React from 'react';
import { motion } from 'framer-motion';

export default function CodeExample() {
  return (
    <section
      id="get-started"
      className="max-w-6xl mx-auto px-6 py-16 scroll-mt-20"
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const }}
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
            {/* Terminal header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-white/10">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-mono">
                classify.ts
              </span>
            </div>
            <pre className="p-5 text-sm leading-relaxed overflow-x-auto font-mono">
              <code>
                <Line>
                  <Kw>import</Kw> {'{ ax, ai }'} <Kw>from</Kw>{' '}
                  <Str>&apos;@ax-llm/ax&apos;</Str>
                </Line>
                <Line />
                <Line>
                  <Cm>{'// Create an AI instance'}</Cm>
                </Line>
                <Line>
                  <Kw>const</Kw> llm = <Fn>ai</Fn>({'{'} <Prop>name</Prop>:{' '}
                  <Str>&apos;openai&apos;</Str> {'}'})
                </Line>
                <Line />
                <Line>
                  <Cm>{'// Define a classifier with a signature'}</Cm>
                </Line>
                <Line>
                  <Kw>const</Kw> classify = <Fn>ax</Fn>(
                </Line>
                <Line>
                  {'  '}
                  <Str>
                    &apos;review:string -&gt; sentiment:class &quot;positive,
                    negative, neutral&quot;&apos;
                  </Str>
                </Line>
                <Line>)</Line>
                <Line />
                <Line>
                  <Cm>{'// Run it'}</Cm>
                </Line>
                <Line>
                  <Kw>const</Kw> result = <Kw>await</Kw> classify.
                  <Fn>forward</Fn>(llm, {'{'}
                </Line>
                <Line>
                  {'  '}
                  <Prop>review</Prop>:{' '}
                  <Str>&apos;This product is amazing!&apos;</Str>
                </Line>
                <Line>{'}'})</Line>
              </code>
            </pre>
          </div>

          {/* Output */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            {/* Terminal header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-white/10">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-mono">
                output
              </span>
            </div>
            <div className="p-5 flex flex-col justify-center h-[calc(100%-48px)]">
              <pre className="text-sm leading-relaxed font-mono">
                <code>
                  <Line>{'{'}</Line>
                  <Line>
                    {'  '}
                    <Prop>sentiment</Prop>: <Str>&apos;positive&apos;</Str>
                  </Line>
                  <Line>{'}'}</Line>
                </code>
              </pre>
              <div className="mt-8 flex items-center gap-3">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Type-safe, validated, auto-retried on failure
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* Inline syntax highlighting helpers */
function Line({ children }: { children?: React.ReactNode }) {
  return (
    <span className="block text-gray-800 dark:text-gray-200">{children}</span>
  );
}

function Kw({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-purple-600 dark:text-purple-400">{children}</span>
  );
}

function Str({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-emerald-600 dark:text-emerald-400">{children}</span>
  );
}

function Fn({ children }: { children: React.ReactNode }) {
  return <span className="text-blue-600 dark:text-blue-400">{children}</span>;
}

function Prop({ children }: { children: React.ReactNode }) {
  return <span className="text-amber-600 dark:text-amber-300">{children}</span>;
}

function Cm({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-400 dark:text-gray-500">{children}</span>;
}
