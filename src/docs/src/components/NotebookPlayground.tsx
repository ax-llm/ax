import { ai } from '@ax-llm/ax';
import { BookOpen, ChevronDown, Cpu, Loader2, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import NotebookCell from './NotebookCell';
import { Button } from './ui/button';

interface Cell {
  id: string;
  content: string;
  createdAt: Date;
}

interface CellState {
  outputs: Record<string, any>;
  executionOrder: number;
}

const EXAMPLE_SIGNATURES = [
  {
    name: 'Sentiment Analysis',
    description: 'Classify text sentiment with confidence',
    signature:
      'inputText:string "Text to analyze" -> sentimentCategory:class "positive,negative,neutral" "Sentiment classification", confidenceScore:number "Confidence 0-1"',
  },
  {
    name: 'Code Generation',
    description: 'Generate code from a problem description',
    signature:
      'problemDescription:string "Programming problem to solve" -> pythonSolution:code "Python code solution", solutionExplanation:string "Explanation of approach"',
  },
  {
    name: 'Data Extraction',
    description: 'Extract structured data from text',
    signature:
      '"Extract key information from customer feedback" customerFeedback:string "Customer feedback text" -> extractedTopics:string[] "Topics mentioned", urgencyLevel:class "low,medium,high" "Priority level", actionItems?:string[] "Optional action items"',
  },
  {
    name: 'Question Answering',
    description: 'Answer questions from context',
    signature:
      'contextText:string "Context information", userQuestion:string "Question to answer" -> answerText:string "Answer based on context", confidenceLevel:number "Answer confidence 0-1"',
  },
  {
    name: 'Chain of Thought',
    description: 'Reasoning before answering',
    signature:
      'problem:string "Problem to solve" -> reasoning!:string "Step by step thinking", answer:string "Final answer", confidence:number "0-1"',
  },
  {
    name: 'Multi-Step Analysis',
    description: 'Research with search queries',
    signature:
      'question:string "Research question" -> searchQueries:string[] "3-5 search queries", analysis:string "Detailed analysis", confidence:number "0-1"',
  },
  {
    name: 'Customer Support',
    description: 'Route and respond to tickets',
    signature:
      'customerMessage:string "Customer message" -> category:class "billing,technical,general" "Issue category", priority:class "high,medium,low" "Priority level", suggestedResponse:string "Draft response"',
  },
  {
    name: 'Translation',
    description: 'Translate with confidence score',
    signature:
      'text:string "Text to translate", targetLanguage:string "Target language" -> translation:string "Translated text", confidence:number "Translation confidence 0-1"',
  },
];

export default function NotebookPlayground() {
  const [cells, setCells] = useState<Cell[]>([
    {
      id: `cell-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      content:
        'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
      createdAt: new Date(),
    },
  ]);

  const [cellStates, setCellStates] = useState<Record<string, CellState>>({});
  const [executionCounter, setExecutionCounter] = useState(0);
  const [cellSignatures, setCellSignatures] = useState<Record<string, any>>({});

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [providerType, setProviderType] = useState<'webllm' | 'openrouter'>(
    'webllm'
  );
  const [selectedModel, setSelectedModel] = useState(
    'Llama-3.2-1B-Instruct-q4f32_1-MLC'
  );
  const [openRouterModel, setOpenRouterModel] = useState('openrouter/auto');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(true);
  const [modelStatus, setModelStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('');
  const [_loadedEngine, setLoadedEngine] = useState<any>(null);
  const [loadedAI, setLoadedAI] = useState<any>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>(
    'idle'
  );

  // Panel toggles
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [showSyntaxRef, setShowSyntaxRef] = useState(false);

  const modelPanelRef = useRef<HTMLDivElement>(null);
  const examplesPanelRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        modelPanelRef.current &&
        !modelPanelRef.current.contains(e.target as Node)
      ) {
        setShowModelPanel(false);
      }
      if (
        examplesPanelRef.current &&
        !examplesPanelRef.current.contains(e.target as Node)
      ) {
        setShowExamples(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  // Reset on provider/model changes
  useEffect(() => {
    setModelStatus('idle');
    setLoadedEngine(null);
    setLoadedAI(null);
    setLoadingProgress(0);
    setLoadingText('Ready');
  }, [selectedModel, providerType, openRouterModel]);

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ax-notebook-playground-v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.cells)) {
          setCells(
            parsed.cells.map((c: any) => ({
              id:
                c.id ||
                `cell-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              content:
                c.content ||
                'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
              createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
            }))
          );
        }
        if (
          parsed.providerType === 'openrouter' ||
          parsed.providerType === 'webllm'
        ) {
          setProviderType(parsed.providerType);
        }
        if (typeof parsed.selectedModel === 'string') {
          setSelectedModel(parsed.selectedModel);
        }
        if (typeof parsed.openRouterModel === 'string') {
          setOpenRouterModel(parsed.openRouterModel);
        }
        if (typeof parsed.rememberApiKey === 'boolean') {
          setRememberApiKey(parsed.rememberApiKey);
        }
        if (
          parsed.rememberApiKey &&
          typeof parsed.openRouterApiKey === 'string'
        ) {
          setOpenRouterApiKey(parsed.openRouterApiKey);
        }
      }
    } catch (_e) {
      // ignore
    }
  }, []);

  // Autosave to localStorage (debounced)
  useEffect(() => {
    setSaveState('saving');
    const t = setTimeout(() => {
      try {
        const payload = {
          cells: cells.map((c) => ({
            id: c.id,
            content: c.content,
            createdAt: c.createdAt.toISOString(),
          })),
          providerType,
          selectedModel,
          openRouterModel,
          rememberApiKey,
          openRouterApiKey: rememberApiKey ? openRouterApiKey : undefined,
        };
        localStorage.setItem(
          'ax-notebook-playground-v1',
          JSON.stringify(payload)
        );
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 800);
      } catch (_e) {
        setSaveState('idle');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [
    cells,
    providerType,
    selectedModel,
    openRouterModel,
    openRouterApiKey,
    rememberApiKey,
  ]);

  const generateCellId = useCallback(() => {
    return `cell-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }, []);

  const addCell = useCallback(
    (afterCellId?: string) => {
      const newCell: Cell = {
        id: generateCellId(),
        content:
          'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
        createdAt: new Date(),
      };
      setCells((prev) => {
        if (afterCellId) {
          const index = prev.findIndex((cell) => cell.id === afterCellId);
          const newCells = [...prev];
          newCells.splice(index + 1, 0, newCell);
          return newCells;
        }
        return [...prev, newCell];
      });
    },
    [generateCellId]
  );

  const deleteCell = useCallback((cellId: string) => {
    setCells((prev) => prev.filter((cell) => cell.id !== cellId));
    setCellStates((prev) => {
      const { [cellId]: _deleted, ...rest } = prev;
      return rest;
    });
  }, []);

  const loadExample = useCallback(
    (signature: string) => {
      const newCell: Cell = {
        id: generateCellId(),
        content: signature,
        createdAt: new Date(),
      };
      setCells((prev) => [...prev, newCell]);
      setShowExamples(false);
    },
    [generateCellId]
  );

  const loadModel = useCallback(async () => {
    setModelStatus('loading');
    setLoadingProgress(0);
    setLoadingText(
      providerType === 'webllm'
        ? 'Checking WebLLM availability...'
        : 'Configuring OpenRouter...'
    );

    try {
      if (providerType === 'webllm') {
        if (typeof window === 'undefined') {
          throw new Error('WebLLM requires a browser environment');
        }
        setLoadingText('Loading WebLLM library...');
        const { MLCEngine } = await import('@mlc-ai/web-llm');
        setLoadingText('Creating WebLLM engine...');
        const engine = new MLCEngine();
        engine.setInitProgressCallback((progress: any) => {
          const percentage = Math.round(progress.progress * 100);
          setLoadingProgress(percentage);
          setLoadingText(`${progress.text} (${percentage}%)`);
        });
        await engine.reload(selectedModel);
        setLoadingText('Creating AI instance...');
        const llm = ai({
          name: 'webllm',
          engine,
          config: { model: selectedModel as any, stream: false },
          options: { debug: true },
        });
        setLoadedEngine(engine);
        setLoadedAI(llm);
        setModelStatus('ready');
        setLoadingProgress(100);
      } else {
        if (!openRouterApiKey) {
          throw new Error('OpenRouter API key is required');
        }
        setLoadingText('Connecting to OpenRouter...');
        const llm = ai({
          name: 'openrouter',
          apiKey: openRouterApiKey,
          config: { model: openRouterModel, stream: false },
          options: { debug: true },
        });
        setLoadedAI(llm);
        setModelStatus('ready');
        setLoadingProgress(100);
        setLoadingText('Connected');
      }
    } catch (error) {
      setModelStatus('error');
      let errorMessage = 'Failed to load model';
      if (error instanceof Error) {
        if (providerType === 'webllm' && error.message.includes('WebLLM')) {
          errorMessage = `WebLLM library error: ${error.message}`;
        } else if (error.message.includes('worker')) {
          errorMessage = `Web Worker error: ${error.message}`;
        } else if (
          error.message.includes('network') ||
          error.message.includes('fetch')
        ) {
          errorMessage = 'Network error loading model';
        } else {
          errorMessage = error.message;
        }
      }
      setLoadingText(errorMessage);
    }
  }, [selectedModel, providerType, openRouterApiKey, openRouterModel]);

  const updateCellSignature = useCallback((cellId: string, signature: any) => {
    setCellSignatures((prev) => ({ ...prev, [cellId]: signature }));
  }, []);

  const updateCellState = useCallback(
    (cellId: string, outputs: Record<string, any>) => {
      setExecutionCounter((prev) => prev + 1);
      setCellStates((prev) => ({
        ...prev,
        [cellId]: { outputs, executionOrder: executionCounter + 1 },
      }));
    },
    [executionCounter]
  );

  const getAvailableOutputs = useCallback(
    (currentCellId: string) => {
      const currentCellIndex = cells.findIndex(
        (cell) => cell.id === currentCellId
      );
      const availableOutputs: Array<{
        cellId: string;
        fieldName: string;
        value: any;
        cellIndex: number;
      }> = [];

      for (let i = 0; i < currentCellIndex; i++) {
        const cell = cells[i];
        const cellState = cellStates[cell.id];
        const cellSignature = cellSignatures[cell.id];

        if (cellSignature) {
          try {
            const outputFields = cellSignature.getOutputFields();
            outputFields.forEach((field: any) => {
              const actualValue = cellState?.outputs?.[field.name];
              availableOutputs.push({
                cellId: cell.id,
                fieldName: field.name,
                value:
                  actualValue !== undefined
                    ? actualValue
                    : '<not yet executed>',
                cellIndex: i,
              });
            });
          } catch (_error) {
            // fallthrough
          }
        } else if (cellState?.outputs) {
          Object.entries(cellState.outputs).forEach(([fieldName, value]) => {
            availableOutputs.push({
              cellId: cell.id,
              fieldName,
              value,
              cellIndex: i,
            });
          });
        }
      }
      return availableOutputs.sort((a, b) => a.cellIndex - b.cellIndex);
    },
    [cells, cellStates, cellSignatures]
  );

  const statusColor =
    modelStatus === 'idle'
      ? 'bg-gray-400'
      : modelStatus === 'loading'
        ? 'bg-yellow-400 animate-pulse'
        : modelStatus === 'ready'
          ? 'bg-emerald-400'
          : 'bg-red-400';

  const statusLabel =
    modelStatus === 'idle'
      ? 'No model'
      : modelStatus === 'loading'
        ? 'Loading...'
        : modelStatus === 'ready'
          ? 'Ready'
          : 'Error';

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {/* Top bar */}
      <div className="sticky top-[64px] z-30 border-b border-gray-200 dark:border-white/20 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          {/* Left: title + cell count + save state */}
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white whitespace-nowrap">
              DSPy Notebook
            </h1>
            <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400">
              {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
            </span>
            {saveState !== 'idle' && (
              <span className="hidden sm:inline text-xs text-gray-400 dark:text-gray-500">
                {saveState === 'saving' ? 'Saving...' : 'Saved'}
              </span>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Syntax reference toggle */}
            <button
              onClick={() => setShowSyntaxRef(!showSyntaxRef)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-white/20 bg-white dark:bg-white/[0.05] hover:bg-gray-50 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Syntax</span>
            </button>

            {/* Examples dropdown */}
            <div className="relative" ref={examplesPanelRef}>
              <button
                onClick={() => {
                  setShowExamples(!showExamples);
                  setShowModelPanel(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-white/20 bg-white dark:bg-white/[0.05] hover:bg-gray-50 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Examples</span>
              </button>
              {showExamples && (
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/20 rounded-xl shadow-xl overflow-hidden z-50">
                  <div className="p-3 border-b border-gray-100 dark:border-white/5">
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      Add an example signature
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto p-2">
                    {EXAMPLE_SIGNATURES.map((example, index) => (
                      <button
                        key={index}
                        onClick={() => loadExample(example.signature)}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                      >
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {example.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {example.description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Model status / config dropdown */}
            <div className="relative" ref={modelPanelRef}>
              <button
                onClick={() => {
                  setShowModelPanel(!showModelPanel);
                  setShowExamples(false);
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 dark:border-white/20 bg-white dark:bg-white/[0.05] hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                <Cpu className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                <span className="text-gray-700 dark:text-gray-300">
                  {statusLabel}
                </span>
                <ChevronDown className="w-3 h-3 text-gray-400" />
              </button>

              {showModelPanel && (
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/20 rounded-xl shadow-xl z-50">
                  <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        Model Settings
                      </h3>
                      <button
                        onClick={() => setShowModelPanel(false)}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded"
                      >
                        <X className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </div>

                    {/* Provider */}
                    <div>
                      <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                        Provider
                      </label>
                      <select
                        className="w-full px-3 py-2 border border-gray-200 dark:border-white/20 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                        value={providerType}
                        onChange={(e) => setProviderType(e.target.value as any)}
                        disabled={modelStatus === 'loading'}
                      >
                        <option value="webllm">Local (WebLLM)</option>
                        <option value="openrouter">OpenRouter (Cloud)</option>
                      </select>
                    </div>

                    {/* Model selection */}
                    {providerType === 'webllm' ? (
                      <div>
                        <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                          Model
                        </label>
                        <select
                          className="w-full px-3 py-2 border border-gray-200 dark:border-white/20 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          disabled={modelStatus === 'loading'}
                        >
                          <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC">
                            Llama 3.2 1B (Fastest)
                          </option>
                          <option value="Llama-3.2-3B-Instruct-q4f32_1-MLC">
                            Llama 3.2 3B
                          </option>
                          <option value="Llama-3.1-8B-Instruct-q4f32_1-MLC">
                            Llama 3.1 8B (Better Quality)
                          </option>
                          <option value="Phi-3.5-mini-instruct-q4f32_1-MLC">
                            Phi 3.5 Mini
                          </option>
                          <option value="gemma-2-2b-it-q4f32_1-MLC">
                            Gemma 2 2B
                          </option>
                        </select>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
                          Runs locally in your browser via WebLLM
                        </p>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                            API Key
                          </label>
                          <input
                            className="w-full px-3 py-2 border border-gray-200 dark:border-white/20 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                            type="password"
                            placeholder="Enter OpenRouter API key"
                            value={openRouterApiKey}
                            onChange={(e) =>
                              setOpenRouterApiKey(e.target.value)
                            }
                            disabled={modelStatus === 'loading'}
                          />
                          <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                            <input
                              type="checkbox"
                              checked={rememberApiKey}
                              onChange={(e) =>
                                setRememberApiKey(e.target.checked)
                              }
                              className="rounded"
                            />
                            Remember in this browser
                          </label>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
                            Model
                          </label>
                          <input
                            className="w-full px-3 py-2 border border-gray-200 dark:border-white/20 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
                            type="text"
                            placeholder="e.g. anthropic/claude-3.5-sonnet"
                            value={openRouterModel}
                            onChange={(e) => setOpenRouterModel(e.target.value)}
                            disabled={modelStatus === 'loading'}
                          />
                        </div>
                      </>
                    )}

                    {/* Loading progress */}
                    {modelStatus === 'loading' && (
                      <div className="space-y-2">
                        <div className="w-full bg-gray-100 dark:bg-white/[0.07] rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${loadingProgress}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {loadingText}
                        </p>
                      </div>
                    )}

                    {/* Error message */}
                    {modelStatus === 'error' && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {loadingText}
                      </p>
                    )}

                    {/* Load button */}
                    <Button
                      onClick={loadModel}
                      disabled={modelStatus === 'loading'}
                      className="w-full"
                      variant={modelStatus === 'ready' ? 'outline' : 'default'}
                      size="sm"
                    >
                      {modelStatus === 'loading' ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          {providerType === 'webllm'
                            ? 'Loading...'
                            : 'Connecting...'}
                        </>
                      ) : modelStatus === 'ready' ? (
                        providerType === 'webllm' ? (
                          'Reload Model'
                        ) : (
                          'Reconnect'
                        )
                      ) : providerType === 'webllm' ? (
                        'Load Model'
                      ) : (
                        'Connect'
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Add cell */}
            <Button
              onClick={() => addCell()}
              variant="outline"
              size="sm"
              className="h-8"
            >
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Add Cell</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Syntax quick-reference (collapsible) */}
      {showSyntaxRef && (
        <div className="border-b border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-white/[0.02]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Signature Syntax Reference
              </h3>
              <button
                onClick={() => setShowSyntaxRef(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Format
                </div>
                <code className="block bg-white dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 font-mono">
                  input:type "desc" {'->'} output:type "desc"
                </code>
                <div className="mt-2 space-y-1 text-gray-500 dark:text-gray-400">
                  <div>
                    <code className="text-emerald-600 dark:text-emerald-400">
                      ?
                    </code>{' '}
                    optional &middot;{' '}
                    <code className="text-emerald-600 dark:text-emerald-400">
                      []
                    </code>{' '}
                    array &middot;{' '}
                    <code className="text-emerald-600 dark:text-emerald-400">
                      !
                    </code>{' '}
                    internal (hidden)
                  </div>
                </div>
              </div>
              <div>
                <div className="font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Field Types
                </div>
                <div className="flex flex-wrap gap-1">
                  {[
                    'string',
                    'number',
                    'boolean',
                    'date',
                    'datetime',
                    'json',
                    'code',
                    'class',
                    'url',
                    'image',
                    'audio',
                  ].map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded bg-white dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 font-mono text-gray-600 dark:text-gray-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-gray-500 dark:text-gray-400">
                  <code className="text-blue-600 dark:text-blue-400">
                    class
                  </code>{' '}
                  requires options: <code>:class "opt1,opt2,opt3"</code>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/20">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Examples
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <code className="block bg-white dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 rounded px-2 py-1 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                  question:string {'->'} answer:string
                </code>
                <code className="block bg-white dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 rounded px-2 py-1 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                  text:string {'->'} mood:class "happy,sad,neutral"
                </code>
                <code className="block bg-white dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 rounded px-2 py-1 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                  problem:string {'->'} reasoning!:string, answer:string
                </code>
                <code className="block bg-white dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 rounded px-2 py-1 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                  doc:string {'->'} tags:string[], summary:string
                </code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cells area */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {cells.map((cell) => (
          <NotebookCell
            key={cell.id}
            cellId={cell.id}
            initialContent={cell.content}
            loadedAI={loadedAI}
            modelStatus={modelStatus}
            isDarkMode={isDarkMode}
            onDelete={cells.length > 1 ? deleteCell : undefined}
            onAddCell={addCell}
            onUpdateCellState={updateCellState}
            onUpdateCellSignature={updateCellSignature}
            availableOutputs={getAvailableOutputs(cell.id)}
          />
        ))}

        {/* Add cell at end */}
        <div className="flex justify-center py-4">
          <Button
            onClick={() => addCell()}
            variant="outline"
            size="sm"
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 border-dashed"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Cell
          </Button>
        </div>
      </div>
    </div>
  );
}
