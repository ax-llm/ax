import type React from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

type Tab = 'fluent' | 'string';

/* ─── Code content for each tab ─── */

function FluentCode() {
  return (
    <pre className="p-5 text-[13px] leading-relaxed overflow-x-auto font-mono">
      <code>
        <L>
          <Kw>import</Kw> {'{ f, ax, ai }'} <Kw>from</Kw>{' '}
          <S>&apos;@ax-llm/ax&apos;</S>
        </L>
        <L />
        <L>
          <Kw>const</Kw> sig = <Fn>f</Fn>()
        </L>
        <L>
          {' '}
          .<Fn>input</Fn>(<S>&apos;document&apos;</S>, <Fn>f</Fn>.
          <Fn>string</Fn>().<Fn>min</Fn>(<N>10</N>))
        </L>
        <L>
          {' '}
          .<Fn>output</Fn>(<S>&apos;summary&apos;</S>, <Fn>f</Fn>.
          <Fn>string</Fn>().<Fn>max</Fn>(<N>500</N>))
        </L>
        <L>
          {' '}
          .<Fn>output</Fn>(<S>&apos;entities&apos;</S>, <Fn>f</Fn>.
          <Fn>object</Fn>({'{'}
        </L>
        <L>
          {' '}
          <P>name</P>: <Fn>f</Fn>.<Fn>string</Fn>().<Fn>min</Fn>(<N>1</N>),
        </L>
        <L>
          {' '}
          <P>type</P>: <Fn>f</Fn>.<Fn>class</Fn>([<S>&apos;person&apos;</S>,{' '}
          <S>&apos;org&apos;</S>, <S>&apos;place&apos;</S>]),
        </L>
        <L>
          {' '}
          <P>confidence</P>: <Fn>f</Fn>.<Fn>number</Fn>().<Fn>min</Fn>(<N>0</N>
          ).<Fn>max</Fn>(<N>1</N>),
        </L>
        <L>
          {' '}
          {'}'}).<Fn>array</Fn>())
        </L>
        <L>
          {' '}
          .<Fn>output</Fn>(<S>&apos;contact&apos;</S>, <Fn>f</Fn>.
          <Fn>object</Fn>({'{'}
        </L>
        <L>
          {' '}
          <P>email</P>: <Fn>f</Fn>.<Fn>email</Fn>(),
        </L>
        <L>
          {' '}
          <P>website</P>: <Fn>f</Fn>.<Fn>url</Fn>().<Fn>optional</Fn>(),
        </L>
        <L> {'}'}))</L>
        <L>
          {' '}
          .<Fn>output</Fn>(<S>&apos;tags&apos;</S>, <Fn>f</Fn>.<Fn>string</Fn>
          ().<Fn>array</Fn>())
        </L>
        <L>
          {' '}
          .<Fn>build</Fn>()
        </L>
        <L />
        <L>
          <Kw>const</Kw> gen = <Fn>ax</Fn>(sig)
        </L>
        <L>
          <Kw>const</Kw> result = <Kw>await</Kw> gen.<Fn>forward</Fn>(llm, {'{'}
        </L>
        <L>
          {' '}
          <P>document</P>: contractText
        </L>
        <L>{'}'})</L>
      </code>
    </pre>
  );
}

function StringCode() {
  return (
    <pre className="p-5 text-[13px] leading-relaxed overflow-x-auto font-mono">
      <code>
        <L>
          <Kw>import</Kw> {'{ ax, ai }'} <Kw>from</Kw>{' '}
          <S>&apos;@ax-llm/ax&apos;</S>
        </L>
        <L />
        <L>
          <C>{'// String shorthand — fast and concise'}</C>
        </L>
        <L>
          <Kw>const</Kw> classify = <Fn>ax</Fn>(
        </L>
        <L>
          {' '}
          <S>
            &apos;text:string -&gt; sentiment:class &quot;pos, neg,
            neutral&quot;&apos;
          </S>
        </L>
        <L>)</L>
        <L />
        <L>
          <C>{'// Multi-field extraction'}</C>
        </L>
        <L>
          <Kw>const</Kw> extract = <Fn>ax</Fn>(
        </L>
        <L>
          {' '}
          <S>
            &apos;doc:string -&gt; names:string[], dates:date[],
            amounts:number[]&apos;
          </S>
        </L>
        <L>)</L>
        <L />
        <L>
          <C>{'// Chain-of-thought with internal reasoning'}</C>
        </L>
        <L>
          <Kw>const</Kw> solve = <Fn>ax</Fn>(
        </L>
        <L>
          {' '}
          <S>
            &apos;problem:string -&gt; reasoning!:string, answer:string&apos;
          </S>
        </L>
        <L>)</L>
        <L />
        <L>
          <C>{'// Multi-modal'}</C>
        </L>
        <L>
          <Kw>const</Kw> describe = <Fn>ax</Fn>(
        </L>
        <L>
          {' '}
          <S>&apos;photo:image, question:string -&gt; answer:string&apos;</S>
        </L>
        <L>)</L>
        <L />
        <L>
          <C>{'// Run any of them the same way'}</C>
        </L>
        <L>
          <Kw>const</Kw> result = <Kw>await</Kw> classify.<Fn>forward</Fn>(llm,{' '}
          {'{'}
        </L>
        <L>
          {' '}
          <P>text</P>: <S>&apos;Best purchase ever!&apos;</S>
        </L>
        <L>{'}'})</L>
      </code>
    </pre>
  );
}

function FluentOutput() {
  return (
    <div className="p-5 flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-3">
        Typed Output
      </div>
      <pre className="text-[13px] leading-relaxed font-mono flex-1">
        <code>
          <L>{'{'}</L>
          <L>
            {' '}
            <P>summary</P>: <S>&apos;Service agreement between...&apos;</S>,
          </L>
          <L>
            {' '}
            <P>entities</P>: [
          </L>
          <L>
            {' '}
            {'{'} <P>name</P>: <S>&apos;Acme Corp&apos;</S>,
          </L>
          <L>
            {' '}
            <P>type</P>: <S>&apos;org&apos;</S>,
          </L>
          <L>
            {' '}
            <P>confidence</P>: <N>0.95</N> {'}'},
          </L>
          <L>
            {' '}
            {'{'} <P>name</P>: <S>&apos;Jane Smith&apos;</S>,
          </L>
          <L>
            {' '}
            <P>type</P>: <S>&apos;person&apos;</S>,
          </L>
          <L>
            {' '}
            <P>confidence</P>: <N>0.88</N> {'}'},
          </L>
          <L> ],</L>
          <L>
            {' '}
            <P>contact</P>: {'{'}
          </L>
          <L>
            {' '}
            <P>email</P>: <S>&apos;jane@acme.com&apos;</S>,
          </L>
          <L>
            {' '}
            <P>website</P>: <S>&apos;https://acme.com&apos;</S>
          </L>
          <L> {'}'},</L>
          <L>
            {' '}
            <P>tags</P>: [<S>&apos;contract&apos;</S>, <S>&apos;legal&apos;</S>,{' '}
            <S>&apos;NDA&apos;</S>]
          </L>
          <L>{'}'}</L>
        </code>
      </pre>
      <div className="mt-4 space-y-2">
        <Feature color="bg-emerald-500" text="Nested objects & typed arrays" />
        <Feature color="bg-purple-500" text="Email & URL format validated" />
        <Feature color="bg-cyan-500" text="Auto-retry on validation failure" />
      </div>
    </div>
  );
}

function StringOutput() {
  return (
    <div className="p-5 flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-3">
        Typed Output
      </div>
      <pre className="text-[13px] leading-relaxed font-mono flex-1">
        <code>
          <L>
            <C>{'// classify'}</C>
          </L>
          <L>
            {'{'} <P>sentiment</P>: <S>&apos;pos&apos;</S> {'}'}
          </L>
          <L />
          <L>
            <C>{'// extract'}</C>
          </L>
          <L>
            {'{'} <P>names</P>: [<S>&apos;Alice&apos;</S>,{' '}
            <S>&apos;Bob&apos;</S>],
          </L>
          <L>
            {' '}
            <P>dates</P>: [<S>&apos;2025-03-15&apos;</S>],
          </L>
          <L>
            {' '}
            <P>amounts</P>: [<N>1500</N>, <N>3200</N>] {'}'}
          </L>
          <L />
          <L>
            <C>{'// solve (reasoning is hidden)'}</C>
          </L>
          <L>
            {'{'} <P>answer</P>: <S>&apos;42&apos;</S> {'}'}
          </L>
          <L />
          <L>
            <C>{'// describe'}</C>
          </L>
          <L>
            {'{'} <P>answer</P>: <S>&apos;A golden retriever...&apos;</S> {'}'}
          </L>
        </code>
      </pre>
      <div className="mt-4 space-y-2">
        <Feature color="bg-amber-500" text="Concise one-liner signatures" />
        <Feature color="bg-pink-500" text="Internal fields hide reasoning" />
        <Feature color="bg-blue-500" text="Images, audio, dates built-in" />
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export default function SignatureShowcase() {
  const [tab, setTab] = useState<Tab>('fluent');

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
            Two ways to define signatures
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Quick string syntax for simple tasks. Fluent builder for complex
            structured outputs with validation.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex rounded-xl bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 p-1">
            <TabButton
              active={tab === 'fluent'}
              onClick={() => setTab('fluent')}
              label="Fluent Builder"
            />
            <TabButton
              active={tab === 'string'}
              onClick={() => setTab('string')}
              label="String Syntax"
            />
          </div>
        </div>

        {/* Code panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left: Code input */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            <TerminalHeader
              filename={tab === 'fluent' ? 'analyze.ts' : 'signatures.ts'}
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {tab === 'fluent' ? <FluentCode /> : <StringCode />}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right: Output */}
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            <TerminalHeader filename="output" />
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="h-[calc(100%-48px)]"
              >
                {tab === 'fluent' ? <FluentOutput /> : <StringOutput />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ─── Shared sub-components ─── */

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

/* ─── Syntax highlighting helpers ─── */

function L({ children }: { children?: React.ReactNode }) {
  return (
    <span className="block text-gray-800 dark:text-gray-200">{children}</span>
  );
}

function Kw({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-purple-600 dark:text-purple-400">{children}</span>
  );
}

function S({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-emerald-600 dark:text-emerald-400">{children}</span>
  );
}

function Fn({ children }: { children: React.ReactNode }) {
  return <span className="text-blue-600 dark:text-blue-400">{children}</span>;
}

function P({ children }: { children: React.ReactNode }) {
  return <span className="text-amber-600 dark:text-amber-300">{children}</span>;
}

function N({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-orange-500 dark:text-orange-400">{children}</span>
  );
}

function C({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-400 dark:text-gray-500">{children}</span>;
}
