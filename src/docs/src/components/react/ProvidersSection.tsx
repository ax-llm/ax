import { motion } from 'framer-motion';

interface Provider {
  name: string;
  code: string;
  color: string;
}

const providers: Provider[] = [
  {
    name: 'OpenAI',
    code: `ai({ name: 'openai' })`,
    color: 'text-green-600 dark:text-green-400',
  },
  {
    name: 'Anthropic',
    code: `ai({ name: 'anthropic' })`,
    color: 'text-orange-600 dark:text-orange-400',
  },
  {
    name: 'Google Gemini',
    code: `ai({ name: 'google-gemini' })`,
    color: 'text-blue-600 dark:text-blue-400',
  },
  {
    name: 'Ollama',
    code: `ai({ name: 'ollama' })`,
    color: 'text-gray-700 dark:text-gray-300',
  },
  {
    name: 'Cohere',
    code: `ai({ name: 'cohere' })`,
    color: 'text-purple-600 dark:text-purple-400',
  },
  {
    name: 'DeepSeek',
    code: `ai({ name: 'deepseek' })`,
    color: 'text-sky-600 dark:text-sky-400',
  },
  {
    name: 'Groq',
    code: `ai({ name: 'groq' })`,
    color: 'text-red-600 dark:text-red-400',
  },
  {
    name: 'Together',
    code: `ai({ name: 'together' })`,
    color: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    name: 'Mistral',
    code: `ai({ name: 'mistral' })`,
    color: 'text-amber-600 dark:text-amber-400',
  },
  {
    name: 'HuggingFace',
    code: `ai({ name: 'huggingface' })`,
    color: 'text-yellow-600 dark:text-yellow-400',
  },
  {
    name: 'Reka',
    code: `ai({ name: 'reka' })`,
    color: 'text-teal-600 dark:text-teal-400',
  },
  {
    name: 'AWS Bedrock',
    code: `new AxAIBedrock({ region: 'us-east-2' })`,
    color: 'text-orange-600 dark:text-orange-300',
  },
];

const fieldTypes = [
  { type: 'string', example: 'name:string', desc: 'Text' },
  { type: 'number', example: 'score:number', desc: 'Numeric' },
  { type: 'boolean', example: 'valid:boolean', desc: 'True/false' },
  { type: 'class', example: 'cat:class "a,b"', desc: 'Enum' },
  { type: 'string[]', example: 'tags:string[]', desc: 'Array' },
  { type: 'json', example: 'data:json', desc: 'Object' },
  { type: 'image', example: 'photo:image', desc: 'Image' },
  { type: 'audio', example: 'clip:audio', desc: 'Audio' },
  { type: 'date', example: 'due:date', desc: 'Date' },
  { type: '?', example: 'notes?:string', desc: 'Optional' },
];

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

export default function ProvidersSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Providers */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">
            One interface, every LLM
          </h2>
          <p className="text-base text-gray-600 dark:text-gray-400 mb-6">
            Switch providers with a single line. Your signatures work
            everywhere.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {providers.map((p) => (
              <div
                key={p.name}
                className="rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/8 px-3 py-2.5
                  hover:border-gray-300 dark:hover:border-white/15 transition-colors"
              >
                <div className={`text-sm font-semibold ${p.color} mb-0.5`}>
                  {p.name}
                </div>
                <code className="text-[10px] font-mono text-gray-400 dark:text-gray-500 leading-tight block truncate">
                  {p.code}
                </code>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Field Types */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
        >
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">
            Rich type system
          </h2>
          <p className="text-base text-gray-600 dark:text-gray-400 mb-6">
            Type-safe signatures with automatic validation and retry on failure.
          </p>
          <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-gray-950">
            <div className="grid grid-cols-1 divide-y divide-gray-200 dark:divide-white/5">
              {fieldTypes.map((ft) => (
                <div
                  key={ft.type}
                  className="flex items-center px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <code className="text-sm font-mono font-semibold text-purple-600 dark:text-purple-400 w-20 shrink-0">
                    {ft.type}
                  </code>
                  <code className="text-sm font-mono text-gray-600 dark:text-gray-400 flex-1 truncate">
                    {ft.example}
                  </code>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto pl-3">
                    {ft.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
