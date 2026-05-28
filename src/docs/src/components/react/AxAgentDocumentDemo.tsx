// import { motion } from 'framer-motion';
// import { RefreshCcw, Upload } from 'lucide-react';
// import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// import {
//   AX_AGENT_DEMO_DOCUMENT,
//   AX_AGENT_DEMO_PROMPTS,
// } from '../../lib/axAgentDemoData';
// import { cn } from '../../lib/utils';
// import { Button } from '../ui/button';
// import { Textarea } from '../ui/textarea';

// const EASE = [0.25, 0.46, 0.45, 0.94] as const;

// const fadeUp = (delay = 0) => ({
//   initial: { opacity: 0, y: 28 },
//   whileInView: { opacity: 1, y: 0 },
//   viewport: { once: true, amount: 0.2 },
//   transition: { duration: 0.6, delay, ease: EASE },
// });

// type AxModule = typeof import('@ax-llm/ax');

// type ModelOption = {
//   label: string;
//   value: string;
//   note: string;
//   size: string;
// };

// type ChatMessage = {
//   id: string;
//   role: 'assistant' | 'user' | 'system';
//   text: string;
//   meta?: string;
// };

// const MODEL_OPTIONS: ModelOption[] = [
//   {
//     label: 'Qwen 2.5 0.5B',
//     value: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
//     note: 'Fastest first run for the local demo.',
//     size: '~550 MB',
//   },
//   {
//     label: 'Qwen 2.5 1.5B',
//     value: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
//     note: 'Recommended for a steadier answer quality.',
//     size: '~1.1 GB',
//   },
//   {
//     label: 'Llama 3.2 1B',
//     value: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
//     note: 'A stronger local tier if your device can handle it.',
//     size: '~1.2 GB',
//   },
// ];

// export default function AxAgentDocumentDemo() {
//   const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[1].value);
//   const [modelStatus, setModelStatus] = useState<
//     'idle' | 'loading' | 'ready' | 'error'
//   >('idle');
//   const [loadingProgress, setLoadingProgress] = useState(0);
//   const [loadingText, setLoadingText] = useState(
//     'Boot a local browser model to try the embedded Ax Agent demo.'
//   );
//   const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);
//   const [useCustomDocument, setUseCustomDocument] = useState(false);
//   const [customDocument, setCustomDocument] = useState('');
//   const [draftQuestion, setDraftQuestion] = useState('');
//   const [selectedPromptId, setSelectedPromptId] = useState(
//     AX_AGENT_DEMO_PROMPTS[0].id
//   );
//   const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
//   const [statusLine, setStatusLine] = useState('');
//   const [errorMessage, setErrorMessage] = useState<string | null>(null);
//   const [isRunning, setIsRunning] = useState(false);

//   const engineRef = useRef<any>(null);
//   const aiRef = useRef<any>(null);
//   const axRef = useRef<AxModule | null>(null);
//   const runCounterRef = useRef(0);

//   const activePrompt = useMemo(
//     () =>
//       AX_AGENT_DEMO_PROMPTS.find((prompt) => prompt.id === selectedPromptId) ??
//       AX_AGENT_DEMO_PROMPTS[0],
//     [selectedPromptId]
//   );

//   const selectedModelMeta = useMemo(
//     () =>
//       MODEL_OPTIONS.find((option) => option.value === selectedModel) ??
//       MODEL_OPTIONS[1],
//     [selectedModel]
//   );

//   const activeDocument = useMemo(() => {
//     if (useCustomDocument && customDocument.trim()) {
//       return {
//         title: 'Custom local document',
//         subtitle: 'User-provided browser text',
//         description:
//           'Your own text document, held locally in the demo and passed into the Ax Agent context field.',
//         text: customDocument.trim(),
//       };
//     }

//     return AX_AGENT_DEMO_DOCUMENT;
//   }, [customDocument, useCustomDocument]);

//   const suggestedQuestion = draftQuestion.trim() || activePrompt.query;

//   useEffect(() => {
//     setGpuAvailable(typeof navigator !== 'undefined' && 'gpu' in navigator);
//   }, []);

//   useEffect(() => {
//     setChatMessages([]);
//     setErrorMessage(null);
//   }, [activeDocument.title]);

//   useEffect(() => {
//     try {
//       const savedModel = localStorage.getItem('ax-agent-demo-model');
//       if (
//         savedModel &&
//         MODEL_OPTIONS.some((option) => option.value === savedModel)
//       ) {
//         setSelectedModel(savedModel);
//       }

//       const savedDocument = localStorage.getItem('ax-agent-demo-document');
//       if (savedDocument) {
//         setCustomDocument(savedDocument);
//       }
//     } catch (_error) {
//       // ignore storage failures
//     }
//   }, []);

//   useEffect(() => {
//     try {
//       localStorage.setItem('ax-agent-demo-model', selectedModel);
//       if (customDocument.trim()) {
//         localStorage.setItem('ax-agent-demo-document', customDocument);
//       }
//     } catch (_error) {
//       // ignore storage failures
//     }
//   }, [selectedModel, customDocument]);

//   useEffect(() => {
//     return () => {
//       const engine = engineRef.current;
//       if (engine?.unload) {
//         void engine.unload();
//       }
//     };
//   }, []);

//   const appendMessage = useCallback((message: ChatMessage) => {
//     setChatMessages((prev) => [...prev, message]);
//   }, []);

//   const resetConversation = useCallback(() => {
//     setChatMessages([]);
//     setErrorMessage(null);
//     setStatusLine('Chat reset.');
//   }, []);

//   const handleTextUpload = useCallback(
//     async (event: React.ChangeEvent<HTMLInputElement>) => {
//       const file = event.target.files?.[0];
//       if (!file) {
//         return;
//       }

//       const text = await file.text();
//       setCustomDocument(text);
//       setUseCustomDocument(true);
//       event.target.value = '';
//     },
//     []
//   );

//   const loadModel = useCallback(async () => {
//     if (modelStatus === 'loading') {
//       return;
//     }

//     setModelStatus('loading');
//     setLoadingProgress(2);
//     setErrorMessage(null);
//     setLoadingText(`Booting ${selectedModelMeta.label} locally...`);
//     setStatusLine(
//       'Loading the browser model for the embedded demo. No backend or API key is used here.'
//     );

//     try {
//       const axModule = axRef.current ?? (await import('@ax-llm/ax'));
//       axRef.current = axModule;

//       if (engineRef.current?.unload) {
//         await engineRef.current.unload();
//       }

//       const engine = await createLocalEngine(selectedModel);
//       engine.setInitProgressCallback((report) => {
//         setLoadingProgress(Math.max(3, Math.round(report.progress * 100)));
//         setLoadingText(report.text);
//       });
//       await engine.reload(selectedModel);

//       engineRef.current = engine;
//       aiRef.current = axModule.ai({
//         name: 'openai',
//         engine,
//         config: {
//           model: selectedModel as any,
//         },
//       });

//       setModelStatus('ready');
//       setLoadingProgress(100);
//       setLoadingText('Local model ready. Ask the document a question.');
//       setStatusLine(
//         'Model ready. The demo keeps the prompt-side document excerpt extremely small so tiny local models stay within context limits.'
//       );
//     } catch (error) {
//       const message = error instanceof Error ? error.message : String(error);
//       setModelStatus('error');
//       setErrorMessage(message);
//       setLoadingText(message);
//       setStatusLine(
//         'Model load failed. Try the smallest local tier or confirm WebGPU is available.'
//       );
//     }
//   }, [modelStatus, selectedModel, selectedModelMeta.label]);

//   const askDocument = useCallback(
//     async (question: string) => {
//       const browserAI = aiRef.current;
//       if (!browserAI) {
//         setErrorMessage(
//           'Load a browser model before asking the document agent.'
//         );
//         return;
//       }

//       if (!activeDocument.text.trim()) {
//         setErrorMessage('Add a document before running the demo.');
//         return;
//       }

//       const currentRun = runCounterRef.current + 1;
//       runCounterRef.current = currentRun;
//       setIsRunning(true);
//       setErrorMessage(null);
//       appendMessage({
//         id: `user-${Date.now()}`,
//         role: 'user',
//         text: question,
//       });
//       setStatusLine(
//         'Running a compact RLM loop over the document. The full text stays in runtime while the prompt excerpt stays tiny.'
//       );

//       try {
//         const axModule = axRef.current ?? (await import('@ax-llm/ax'));
//         axRef.current = axModule;
//         const { AxJSRuntime, agent } = axModule;

//         const documentAgent = agent(
//           'document:string, question:string -> answer:string',
//           {
//             agentIdentity: {
//               name: 'Document Chat Agent',
//               description:
//                 'Answers questions about a large document using Ax Agent context fields and a persistent JS runtime.',
//             },
//             contextFields: [
//               {
//                 field: 'document',
//                 keepInPromptChars: 160,
//               },
//             ],
//             runtime: new AxJSRuntime(),
//             maxTurns: 4,

//             contextPolicy: {
//               preset: 'checkpointed',
//               budget: 'compact',
//             },
//             maxRuntimeChars: 700,
//             agentStatusCallback: (message, status) => {
//               if (runCounterRef.current !== currentRun) {
//                 return;
//               }

//               setStatusLine(
//                 status === 'success' ? message : `Agent warning: ${message}`
//               );
//             },
//             actorOptions: {
//               description: [
//                 'You are answering questions about a large document held in inputs.document.',
//                 'The prompt budget is intentionally tiny because this demo targets very small browser models.',
//                 'Do not print or summarize the entire document.',
//                 'Use JavaScript to narrow the task: inspect headings, split into sections, search by keyword, and slice only likely passages.',
//                 'Keep intermediate state in variables and reuse it across turns.',
//                 'Use await success(message) for compact progress updates.',
//                 'In non-final turns emit exactly one console.log(...) and stop.',
//                 'Return a concise, direct answer grounded in the document.',
//               ].join('\n'),
//             },
//           }
//         );

//         const result = await documentAgent.forward(browserAI, {
//           document: activeDocument.text,
//           question,
//         });

//         if (runCounterRef.current !== currentRun) {
//           return;
//         }

//         appendMessage({
//           id: `assistant-${Date.now()}`,
//           role: 'assistant',
//           text: result.answer,
//           meta: 'Answered locally with the document kept in an Ax Agent context field.',
//         });
//         setStatusLine(
//           'Answer complete. The runtime had the full document even though the actor prompt saw only a tiny excerpt.'
//         );
//       } catch (error) {
//         if (runCounterRef.current !== currentRun) {
//           return;
//         }

//         const message = error instanceof Error ? error.message : String(error);
//         setErrorMessage(message);
//         appendMessage({
//           id: `error-${Date.now()}`,
//           role: 'system',
//           text: `Run failed: ${message}`,
//           meta: 'Try a narrower question or the smallest model tier.',
//         });
//         setStatusLine(
//           'The local run hit a limit. Narrow the question or try the smallest browser model.'
//         );
//       } finally {
//         if (runCounterRef.current === currentRun) {
//           setIsRunning(false);
//         }
//       }
//     },
//     [activeDocument.text, appendMessage]
//   );

//   return (
//     <section
//       id="ax-agent-chat-demo"
//       className="relative bg-white px-6 py-16 dark:bg-slate-950 md:px-10 lg:px-12 lg:py-22"
//     >
//       <div className="mx-auto max-w-7xl">
//         <motion.div {...fadeUp(0)} className="max-w-3xl">
//           <div className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-600 dark:text-emerald-300">
//             Embedded Demo
//           </div>
//           <h2 className="mt-4 text-4xl font-black tracking-[-0.03em] text-slate-950 dark:text-white md:text-5xl">
//             Ask a large document questions in a wide, simple agent chat.
//           </h2>
//           <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">
//             The full document sits in an Ax Agent{' '}
//             <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm dark:bg-white/10">
//               contextField
//             </code>
//             . The actor prompt sees only a tiny excerpt so even very small local
//             models can stay within context limits.
//           </p>
//         </motion.div>

//         <motion.div
//           {...fadeUp(0.06)}
//           className="mt-10 overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/88 shadow-[0_28px_120px_rgba(15,23,42,0.1)] backdrop-blur dark:border-white/10 dark:bg-white/[0.04]"
//         >
//           <div className="border-b border-slate-200/80 px-5 py-4 dark:border-white/10 md:px-6">
//             <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
//               <div>
//                 <div className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
//                   Browser-local demo
//                 </div>
//                 <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
//                   Document chat agent
//                 </div>
//               </div>
//               <div className="flex flex-wrap items-center gap-3">
//                 <select
//                   value={selectedModel}
//                   onChange={(event) => {
//                     setSelectedModel(event.target.value);
//                     setModelStatus('idle');
//                     aiRef.current = null;
//                     setLoadingProgress(0);
//                     setLoadingText(
//                       'Switch models, then boot the browser model again.'
//                     );
//                     resetConversation();
//                   }}
//                   className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-cyan-500 dark:border-white/10 dark:bg-slate-950/70 dark:text-white"
//                 >
//                   {MODEL_OPTIONS.map((option) => (
//                     <option key={option.value} value={option.value}>
//                       {option.label}
//                     </option>
//                   ))}
//                 </select>
//                 <Button
//                   onClick={() => void loadModel()}
//                   disabled={modelStatus === 'loading' || gpuAvailable === false}
//                   className="h-10 rounded-xl bg-slate-950 px-4 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
//                 >
//                   {modelStatus === 'ready' ? 'Reload Model' : 'Load Model'}
//                 </Button>
//               </div>
//             </div>
//             <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
//               <div
//                 className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-emerald-500 to-fuchsia-500 transition-all duration-300"
//                 style={{ width: `${loadingProgress}%` }}
//               />
//             </div>
//             <div className="mt-3 flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300 md:flex-row md:items-center md:justify-between">
//               <span>{loadingText}</span>
//               <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
//                 {selectedModelMeta.size}
//               </span>
//             </div>
//           </div>
//           <div className="px-5 py-5 md:px-6">
//             <div className="flex flex-wrap items-center gap-2">
//               <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-white">
//                 {activeDocument.title}
//               </span>
//               <button
//                 type="button"
//                 onClick={() => setUseCustomDocument(false)}
//                 className={cn(
//                   'rounded-full border px-3 py-1.5 text-xs transition-colors',
//                   !useCustomDocument
//                     ? 'border-cyan-500/30 bg-cyan-500/10 text-slate-900 dark:text-white'
//                     : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300'
//                 )}
//               >
//                 Built-in doc
//               </button>
//               <button
//                 type="button"
//                 onClick={() => setUseCustomDocument(true)}
//                 className={cn(
//                   'rounded-full border px-3 py-1.5 text-xs transition-colors',
//                   useCustomDocument
//                     ? 'border-emerald-500/30 bg-emerald-500/10 text-slate-900 dark:text-white'
//                     : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300'
//                 )}
//               >
//                 Use your own
//               </button>
//               {useCustomDocument ? (
//                 <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]">
//                   <Upload className="h-3.5 w-3.5" />
//                   Upload text
//                   <input
//                     type="file"
//                     accept=".txt,.md,text/plain,text/markdown"
//                     className="hidden"
//                     onChange={(event) => void handleTextUpload(event)}
//                   />
//                 </label>
//               ) : null}
//             </div>

//             {useCustomDocument ? (
//               <div className="mt-4">
//                 <Textarea
//                   value={customDocument}
//                   onChange={(event) => setCustomDocument(event.target.value)}
//                   placeholder="Paste a long text or markdown document here."
//                   className="min-h-[140px] rounded-2xl border-slate-200 bg-white/90 dark:border-white/10 dark:bg-slate-950/60"
//                 />
//               </div>
//             ) : null}

//             <div className="mt-5 h-[24rem] overflow-y-auto rounded-[1.6rem] border border-slate-200/80 bg-slate-50/80 px-4 py-4 dark:border-white/10 dark:bg-slate-950/55 md:px-5">
//               {chatMessages.length === 0 ? (
//                 <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
//                   Ask a question to start the chat.
//                 </div>
//               ) : (
//                 <div className="space-y-4">
//                   {chatMessages.map((message) => (
//                     <div
//                       key={message.id}
//                       className={cn(
//                         'flex',
//                         message.role === 'user'
//                           ? 'justify-end'
//                           : 'justify-start'
//                       )}
//                     >
//                       <div
//                         className={cn(
//                           'max-w-[88%] rounded-[1.35rem] px-4 py-3 text-sm leading-7 shadow-sm',
//                           message.role === 'user' &&
//                             'bg-slate-950 text-white dark:bg-white dark:text-slate-950',
//                           message.role === 'assistant' &&
//                             'border border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200',
//                           message.role === 'system' &&
//                             'border border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-100'
//                         )}
//                       >
//                         <div>{message.text}</div>
//                         {message.meta ? (
//                           <div className="mt-2 text-[11px] uppercase tracking-[0.2em] opacity-70">
//                             {message.meta}
//                           </div>
//                         ) : null}
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               )}
//             </div>

//             {statusLine ? (
//               <div className="mt-4 rounded-[1.25rem] border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-600 dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-300">
//                 {statusLine}
//               </div>
//             ) : null}

//             <div className="mt-4 space-y-3">
//               <Textarea
//                 value={draftQuestion}
//                 onChange={(event) => setDraftQuestion(event.target.value)}
//                 placeholder="Ask the document a question."
//                 className="min-h-[110px] rounded-2xl border-slate-200 bg-white/90 dark:border-white/10 dark:bg-slate-950/60"
//               />
//               <div className="flex flex-wrap gap-2">
//                 {AX_AGENT_DEMO_PROMPTS.map((prompt) => (
//                   <button
//                     key={prompt.id}
//                     type="button"
//                     onClick={() => {
//                       setSelectedPromptId(prompt.id);
//                       setDraftQuestion(prompt.query);
//                     }}
//                     className={cn(
//                       'rounded-full border px-3 py-2 text-xs transition-colors',
//                       selectedPromptId === prompt.id
//                         ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-slate-900 dark:text-white'
//                         : 'border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200'
//                     )}
//                   >
//                     {prompt.label}
//                   </button>
//                 ))}
//               </div>
//               <div className="flex flex-wrap gap-3">
//                 <Button
//                   onClick={() => void askDocument(suggestedQuestion)}
//                   disabled={
//                     modelStatus !== 'ready' ||
//                     isRunning ||
//                     !suggestedQuestion.trim() ||
//                     !activeDocument.text.trim()
//                   }
//                   className="h-11 rounded-xl bg-gradient-to-r from-cyan-600 via-emerald-600 to-fuchsia-600 text-white hover:opacity-95"
//                 >
//                   {isRunning ? 'Thinking Locally…' : 'Ask The Agent'}
//                 </Button>
//                 <Button
//                   variant="outline"
//                   onClick={resetConversation}
//                   disabled={isRunning}
//                   className="h-11 rounded-xl"
//                 >
//                   <RefreshCcw className="mr-2 h-4 w-4" />
//                   Reset Chat
//                 </Button>
//               </div>
//               {errorMessage ? (
//                 <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.08] px-4 py-3 text-sm leading-7 text-rose-900 dark:text-rose-100">
//                   {errorMessage}
//                 </div>
//               ) : null}
//               {gpuAvailable === false ? (
//                 <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-900 dark:text-amber-100">
//                   WebGPU is unavailable in this browser, so the local demo
//                   cannot run here.
//                 </div>
//               ) : null}
//             </div>
//           </div>
//         </motion.div>
//       </div>
//     </section>
//   );
// }
