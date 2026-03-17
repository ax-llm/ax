import type React from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Brain,
  Bot,
  GitBranch,
  GraduationCap,
  FileSignature,
  Search,
  Play,
} from 'lucide-react';
import { GlowCard } from './GlowCard';

interface Feature {
  name: string;
  description: string;
  icon: React.ElementType;
  glowColor: string;
  iconBg: string;
  iconColor: string;
  span: string;
  href: string;
  external: boolean;
  hero?: boolean;
}

const GITHUB_SKILL = 'https://github.com/ax-llm/ax/blob/main/src/ax/skills';

const features: Feature[] = [
  {
    name: 'AxGen',
    description:
      'The generator engine. Define signatures, get structured LLM outputs with streaming, assertions, and auto-retry.',
    icon: Sparkles,
    glowColor: 'rgba(167, 139, 250, 0.15)',
    iconBg: 'bg-violet-100 dark:bg-violet-500/20',
    iconColor: 'text-violet-600 dark:text-violet-400',
    span: 'md:col-span-3 md:row-span-2',
    href: `${GITHUB_SKILL}/ax-gen.md`,
    external: true,
    hero: true,
  },
  {
    name: 'AxAI',
    description:
      '15+ LLM providers through one unified interface. OpenAI, Anthropic, Google, and more.',
    icon: Brain,
    glowColor: 'rgba(34, 211, 238, 0.15)',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/20',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    span: 'md:col-span-3',
    href: `${GITHUB_SKILL}/ax-ai.md`,
    external: true,
  },
  {
    name: 'AxAgent',
    description:
      'Agents with tools, child agents, and ReAct loop machines for complex multi-step tasks.',
    icon: Bot,
    glowColor: 'rgba(52, 211, 153, 0.15)',
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    span: 'md:col-span-3',
    href: `${GITHUB_SKILL}/ax-agent.md`,
    external: true,
  },
  {
    name: 'AxFlow',
    description:
      'Pipeline orchestration with auto-parallelism and DAG execution.',
    icon: GitBranch,
    glowColor: 'rgba(251, 191, 36, 0.15)',
    iconBg: 'bg-amber-100 dark:bg-amber-500/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
    span: 'md:col-span-2',
    href: `${GITHUB_SKILL}/ax-flow.md`,
    external: true,
  },
  {
    name: 'AxLearn',
    description: 'Self-improving optimization with teacher-student training.',
    icon: GraduationCap,
    glowColor: 'rgba(244, 114, 182, 0.15)',
    iconBg: 'bg-pink-100 dark:bg-pink-500/20',
    iconColor: 'text-pink-600 dark:text-pink-400',
    span: 'md:col-span-2',
    href: `${GITHUB_SKILL}/ax-learn.md`,
    external: true,
  },
  {
    name: 'AxSignature',
    description: 'Type-safe I/O schemas with validation constraints.',
    icon: FileSignature,
    glowColor: 'rgba(45, 212, 191, 0.15)',
    iconBg: 'bg-teal-100 dark:bg-teal-500/20',
    iconColor: 'text-teal-600 dark:text-teal-400',
    span: 'md:col-span-2',
    href: `${GITHUB_SKILL}/ax-signature.md`,
    external: true,
  },
  {
    name: 'AxRAG',
    description:
      'Retrieval-augmented generation with built-in chunking and reranking.',
    icon: Search,
    glowColor: 'rgba(99, 102, 241, 0.15)',
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/20',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    span: 'md:col-span-3',
    href: '/axrag',
    external: false,
  },
  {
    name: 'DSPy Notebook',
    description:
      'Interactive playground to experiment with signatures and prompts live.',
    icon: Play,
    glowColor: 'rgba(251, 191, 36, 0.15)',
    iconBg: 'bg-yellow-100 dark:bg-yellow-500/20',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
    span: 'md:col-span-3',
    href: '/playground',
    external: false,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

export default function FeatureGrid() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-4">
          What&apos;s in the box
        </h2>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          Everything you need to build production AI applications
        </p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        className="grid grid-cols-1 md:grid-cols-6 gap-4 md:gap-5"
      >
        {features.map((feature, i) => (
          <GlowCard
            key={feature.name}
            className={feature.span}
            glowColor={feature.glowColor}
            delay={i * 0.08}
            href={feature.href}
            external={feature.external}
          >
            <div
              className={`p-6 ${feature.hero ? 'md:p-8' : ''} flex flex-col justify-center h-full`}
            >
              <div
                className={`
                  ${feature.hero ? 'w-14 h-14' : 'w-10 h-10'}
                  rounded-xl ${feature.iconBg}
                  border ${feature.iconBg.includes('violet') ? 'border-violet-200 dark:border-violet-500/30' : ''}
                  ${feature.iconBg.includes('cyan') ? 'border-cyan-200 dark:border-cyan-500/30' : ''}
                  ${feature.iconBg.includes('emerald') ? 'border-emerald-200 dark:border-emerald-500/30' : ''}
                  ${feature.iconBg.includes('amber') ? 'border-amber-200 dark:border-amber-500/30' : ''}
                  ${feature.iconBg.includes('pink') ? 'border-pink-200 dark:border-pink-500/30' : ''}
                  ${feature.iconBg.includes('teal') ? 'border-teal-200 dark:border-teal-500/30' : ''}
                  ${feature.iconBg.includes('indigo') ? 'border-indigo-200 dark:border-indigo-500/30' : ''}
                  ${feature.iconBg.includes('yellow') ? 'border-yellow-200 dark:border-yellow-500/30' : ''}
                  flex items-center justify-center mb-4
                `}
              >
                <feature.icon
                  className={`${feature.hero ? 'w-7 h-7' : 'w-5 h-5'} ${feature.iconColor}`}
                />
              </div>
              <h3
                className={`
                  ${feature.hero ? 'text-2xl md:text-3xl' : 'text-lg'}
                  font-bold text-gray-900 dark:text-white mb-2 tracking-tight
                `}
              >
                {feature.name}
              </h3>
              <p
                className={`
                  ${feature.hero ? 'text-base md:text-lg' : 'text-sm'}
                  text-gray-600 dark:text-gray-400 leading-relaxed
                `}
              >
                {feature.description}
              </p>
            </div>
          </GlowCard>
        ))}
      </motion.div>
    </section>
  );
}
