import type React from 'react';
import { motion } from 'framer-motion';
import {
  Tags,
  FileText,
  MessageCircle,
  Languages,
  Image,
  Shield,
  Zap,
  ListChecks,
} from 'lucide-react';

interface Pattern {
  name: string;
  description: string;
  icon: React.ElementType;
  code: string;
  iconBg: string;
  iconColor: string;
}

const patterns: Pattern[] = [
  {
    name: 'Classification',
    description: 'Categorize text into predefined classes',
    icon: Tags,
    code: `'text:string -> category:class "spam, ham, promo"'`,
    iconBg: 'bg-violet-100 dark:bg-violet-500/20',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  {
    name: 'Extraction',
    description: 'Pull structured data from unstructured text',
    icon: FileText,
    code: `'document:string -> names:string[], dates:date[], amounts:number[]'`,
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/20',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    name: 'Question Answering',
    description: 'Answer questions given context',
    icon: MessageCircle,
    code: `'context:string, question:string -> answer:string'`,
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    name: 'Multi-Modal',
    description: 'Process images and audio alongside text',
    icon: Image,
    code: `'photo:image, question:string -> answer:string'`,
    iconBg: 'bg-amber-100 dark:bg-amber-500/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    name: 'Validation',
    description: 'Auto-validate outputs with built-in constraints',
    icon: Shield,
    code: `f.string().email()  f.number().min(0).max(100)`,
    iconBg: 'bg-pink-100 dark:bg-pink-500/20',
    iconColor: 'text-pink-600 dark:text-pink-400',
  },
  {
    name: 'Streaming',
    description: 'Get results as they generate in real-time',
    icon: Zap,
    code: `await gen.forward(llm, input, { stream: true })`,
    iconBg: 'bg-yellow-100 dark:bg-yellow-500/20',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
  },
  {
    name: 'Translation',
    description: 'Translate between any languages',
    icon: Languages,
    code: `'text:string, targetLanguage:string -> translation:string'`,
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/20',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    name: 'Complex Workflows',
    description: 'Multiple typed outputs from a single call',
    icon: ListChecks,
    code: `'doc:string -> summary:string, keyPoints:string[], sentiment:class "pos, neg"'`,
    iconBg: 'bg-teal-100 dark:bg-teal-500/20',
    iconColor: 'text-teal-600 dark:text-teal-400',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export default function PatternsSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4">
          Declare capabilities, not prompts
        </h2>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          Define your inputs and outputs with type-safe signatures. Ax generates
          the optimal prompt automatically.
        </p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {patterns.map((pattern) => (
          <motion.div
            key={pattern.name}
            variants={itemVariants}
            className="group relative rounded-2xl overflow-hidden
              bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300
              dark:bg-none dark:bg-white/[0.05] dark:border-white/10 dark:shadow-none
              dark:hover:border-white/20
              transition-all duration-300 p-5"
          >
            <div
              className={`w-10 h-10 rounded-xl ${pattern.iconBg} flex items-center justify-center mb-3`}
            >
              <pattern.icon className={`w-5 h-5 ${pattern.iconColor}`} />
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
              {pattern.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
              {pattern.description}
            </p>
            <div className="rounded-lg bg-gray-100 dark:bg-black/30 border border-gray-200 dark:border-white/5 px-3 py-2">
              <code className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all leading-relaxed">
                {pattern.code}
              </code>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
