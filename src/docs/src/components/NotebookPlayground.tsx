import { ai } from '@ax-llm/ax';
import { Loader2, Menu, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
    description: 'Analyze text sentiment with confidence',
    signature:
      'inputText:string "Text to analyze" -> sentimentCategory:class "positive,negative,neutral" "Sentiment classification", confidenceScore:number "Confidence 0-1"',
  },
  {
    name: 'Code Generation',
    description: 'Generate programming solutions',
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

  // Global state for cell outputs and execution order
  const [cellStates, setCellStates] = useState<Record<string, CellState>>({});
  const [executionCounter, setExecutionCounter] = useState(0);

  // Track parsed signatures for all cells to get available output fields
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
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>(
    'idle'
  );

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
        } else {
          return [...prev, newCell];
        }
      });
    },
    [generateCellId]
  );

  const deleteCell = useCallback((cellId: string) => {
    setCells((prev) => prev.filter((cell) => cell.id !== cellId));
    // Clean up cell state when cell is deleted
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
      console.error('Detailed error loading model:', error);
      setModelStatus('error');

      // Provide more specific error messages
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

  // Update cell signature when parsed
  const updateCellSignature = useCallback((cellId: string, signature: any) => {
    setCellSignatures((prev) => ({
      ...prev,
      [cellId]: signature,
    }));
  }, []);

  // Update cell outputs when execution completes
  const updateCellState = useCallback(
    (cellId: string, outputs: Record<string, any>) => {
      setExecutionCounter((prev) => prev + 1);
      setCellStates((prev) => ({
        ...prev,
        [cellId]: {
          outputs,
          executionOrder: executionCounter + 1,
        },
      }));
    },
    [executionCounter]
  );

  // Get available outputs from previous cells for input selection
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

      // Only look at cells above the current one
      for (let i = 0; i < currentCellIndex; i++) {
        const cell = cells[i];
        const cellState = cellStates[cell.id];
        const cellSignature = cellSignatures[cell.id];

        // Use parsed signature to get output fields, whether executed or not
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
                    : `<not yet executed>`,
                cellIndex: i,
              });
            });
          } catch (error) {
            console.warn('Error getting output fields from signature:', error);
          }
        } else {
          // Fallback: if no parsed signature, use executed outputs if available
          if (cellState?.outputs) {
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
      }

      return availableOutputs.sort((a, b) => a.cellIndex - b.cellIndex);
    },
    [cells, cellStates, cellSignatures]
  );

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background">
      {/* Mobile Header */}
      <div className="md:hidden border-b p-4 flex justify-between items-center bg-background">
        <button
          onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
          className="p-2 hover:bg-accent rounded-md"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold">DSPy Notebook</h1>
        <button
          onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
          className="flex items-center gap-2 px-3 py-2 hover:bg-accent rounded-md text-sm"
        >
          <div
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              modelStatus === 'idle'
                ? 'bg-gray-400'
                : modelStatus === 'loading'
                  ? 'bg-yellow-400 animate-pulse'
                  : modelStatus === 'ready'
                    ? 'bg-green-400'
                    : 'bg-red-400'
            }`}
          />
          <span className="font-medium">
            {modelStatus === 'idle'
              ? 'Load Model'
              : modelStatus === 'loading'
                ? 'Loading...'
                : modelStatus === 'ready'
                  ? 'Model Ready'
                  : 'Load Failed'}
          </span>
        </button>
      </div>

      {/* Mobile Overlay */}
      {(leftSidebarOpen || rightSidebarOpen) && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          role="button"
          tabIndex={0}
          onClick={() => {
            setLeftSidebarOpen(false);
            setRightSidebarOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setLeftSidebarOpen(false);
              setRightSidebarOpen(false);
            }
          }}
        />
      )}

      {/* Left Sidebar - Examples */}
      <div
        className={`${leftSidebarOpen ? 'fixed inset-y-0 left-0 w-80 z-50' : 'hidden'} md:relative md:block md:w-80 border-r bg-background overflow-y-auto`}
      >
        {/* Mobile close button */}
        <div className="md:hidden p-4 border-b flex justify-between items-center">
          <h2 className="font-semibold">Examples</h2>
          <button
            onClick={() => setLeftSidebarOpen(false)}
            className="p-2 hover:bg-accent rounded-md"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 md:p-6">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium mb-3">Example Templates</h3>
              <div className="space-y-2">
                {EXAMPLE_SIGNATURES.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      loadExample(example.signature);
                      setLeftSidebarOpen(false);
                    }}
                    className="w-full text-left p-3 rounded-lg border bg-background hover:bg-accent text-sm transition-colors"
                  >
                    <div className="font-medium">{example.name}</div>
                    <div className="text-muted-foreground text-xs mt-1">
                      {example.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-3">Notebook Actions</h3>
              <div className="space-y-2">
                <Button
                  onClick={() => {
                    addCell();
                    setLeftSidebarOpen(false);
                  }}
                  variant="outline"
                  className="w-full justify-start"
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Cell
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Toolbar - Hidden on mobile */}
        <div className="hidden md:flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">DSPy Notebook</h1>
            <span className="text-sm text-muted-foreground">
              {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
            </span>
            <span className="text-xs px-2 py-1 rounded border text-muted-foreground">
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'Saved'
                  : 'Autosave on'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => addCell()} variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Cell
            </Button>
          </div>
        </div>

        {/* Notebook Content */}
        <div className="flex-1 flex flex-col md:flex-row">
          {/* Cells Area */}
          <div className="flex-1 p-4 md:p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto w-full">
              {/* Show model loading component in mobile view when model is not ready */}
              {modelStatus !== 'ready' && (
                <div className="md:hidden mb-6 p-6 border rounded-lg bg-muted/50">
                  <div className="text-center space-y-6">
                    <div className="flex items-center justify-center gap-3">
                      <div
                        className={`w-4 h-4 rounded-full transition-all duration-300 ${
                          modelStatus === 'idle'
                            ? 'bg-gray-400'
                            : modelStatus === 'loading'
                              ? 'bg-yellow-400 animate-pulse'
                              : 'bg-red-400'
                        }`}
                      />
                      <h3 className="font-semibold text-lg">
                        {modelStatus === 'idle'
                          ? providerType === 'webllm'
                            ? 'Model Not Loaded'
                            : 'Not Connected'
                          : modelStatus === 'loading'
                            ? 'Loading Model...'
                            : 'Model Load Failed'}
                      </h3>
                    </div>

                    {modelStatus === 'idle' && (
                      <div className="space-y-4">
                        <div className="space-y-3 text-left">
                          <div>
                            <label className="text-sm font-medium block">
                              Provider
                            </label>
                            <select
                              className="w-full p-3 border rounded-md bg-background text-sm"
                              value={providerType}
                              onChange={(e) =>
                                setProviderType(e.target.value as any)
                              }
                            >
                              <option value="webllm">Local (WebLLM)</option>
                              <option value="openrouter">
                                OpenRouter (Cloud)
                              </option>
                            </select>
                          </div>
                          {providerType === 'webllm' ? (
                            <div>
                              <label className="text-sm font-medium block mb-3">
                                Select Model
                              </label>
                              <select
                                className="w-full p-3 border rounded-md bg-background text-sm"
                                value={selectedModel}
                                onChange={(e) =>
                                  setSelectedModel(e.target.value)
                                }
                              >
                                <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC">
                                  Llama 3.2 1B Instruct (Fastest)
                                </option>
                                <option value="Llama-3.2-3B-Instruct-q4f32_1-MLC">
                                  Llama 3.2 3B Instruct
                                </option>
                                <option value="Llama-3.1-8B-Instruct-q4f32_1-MLC">
                                  Llama 3.1 8B Instruct (Better Quality)
                                </option>
                                <option value="Phi-3.5-mini-instruct-q4f32_1-MLC">
                                  Phi 3.5 Mini Instruct
                                </option>
                                <option value="gemma-2-2b-it-q4f32_1-MLC">
                                  Gemma 2 2B Instruct
                                </option>
                              </select>
                              <p className="text-xs text-muted-foreground mt-2">
                                Running locally in your browser with WebLLM
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div>
                                <label className="text-sm font-medium block mb-2">
                                  OpenRouter API Key
                                </label>
                                <input
                                  className="w-full p-3 border rounded-md bg-background text-sm"
                                  type="password"
                                  placeholder="Enter your OpenRouter API key"
                                  value={openRouterApiKey}
                                  onChange={(e) =>
                                    setOpenRouterApiKey(e.target.value)
                                  }
                                />
                                <div className="flex items-center gap-2 mt-2">
                                  <input
                                    id="remember-key-mobile"
                                    type="checkbox"
                                    checked={rememberApiKey}
                                    onChange={(e) =>
                                      setRememberApiKey(e.target.checked)
                                    }
                                  />
                                  <label
                                    htmlFor="remember-key-mobile"
                                    className="text-xs text-muted-foreground"
                                  >
                                    Remember key in this browser
                                  </label>
                                </div>
                              </div>
                              <div>
                                <label className="text-sm font-medium block mb-2">
                                  Model
                                </label>
                                <input
                                  className="w-full p-3 border rounded-md bg-background text-sm"
                                  type="text"
                                  placeholder="e.g. openrouter/auto or anthropic/claude-3.5-sonnet"
                                  value={openRouterModel}
                                  onChange={(e) =>
                                    setOpenRouterModel(e.target.value)
                                  }
                                />
                              </div>
                            </div>
                          )}
                          <Button
                            onClick={loadModel}
                            className="w-full bg-blue-600 hover:bg-blue-700 py-3"
                          >
                            {providerType === 'webllm'
                              ? 'Load Model'
                              : 'Connect'}
                          </Button>
                        </div>
                      </div>
                    )}

                    {modelStatus === 'loading' && (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          {loadingText}
                        </p>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div
                            className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                            style={{ width: `${loadingProgress}%` }}
                          />
                        </div>
                        <div className="text-sm text-muted-foreground font-medium">
                          {loadingProgress}%
                        </div>
                      </div>
                    )}

                    {modelStatus === 'error' && (
                      <div className="space-y-4">
                        <p className="text-sm text-red-600 dark:text-red-400">
                          {loadingText}
                        </p>
                        <Button
                          onClick={loadModel}
                          variant="outline"
                          className="w-full"
                        >
                          Try Again
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                  className="text-muted-foreground hover:text-foreground h-10 md:h-8"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Cell
                </Button>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Model Controls */}
          <div
            className={`${rightSidebarOpen ? 'fixed inset-y-0 right-0 w-80 z-50' : 'hidden'} md:relative md:block md:w-80 border-l bg-background overflow-y-auto`}
          >
            {/* Mobile close button */}
            <div className="md:hidden p-4 border-b flex justify-between items-center">
              <h2 className="font-semibold">Model Settings</h2>
              <button
                onClick={() => setRightSidebarOpen(false)}
                className="p-2 hover:bg-accent rounded-md"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 md:p-6 space-y-4 md:space-y-6">
              {/* Provider & Model */}
              <div className="space-y-3">
                <label className="text-sm font-medium block">Provider</label>
                <select
                  className="w-full p-3 border rounded-md bg-background text-sm"
                  value={providerType}
                  onChange={(e) => setProviderType(e.target.value as any)}
                  disabled={modelStatus === 'loading'}
                >
                  <option value="webllm">Local (WebLLM)</option>
                  <option value="openrouter">OpenRouter (Cloud)</option>
                </select>
              </div>

              {providerType === 'webllm' ? (
                <div>
                  <label className="text-sm font-medium block mb-3">
                    Model
                  </label>
                  <select
                    className="w-full p-3 border rounded-md bg-background text-sm"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={modelStatus === 'loading'}
                  >
                    <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC">
                      Llama 3.2 1B Instruct (Fastest)
                    </option>
                    <option value="Llama-3.2-3B-Instruct-q4f32_1-MLC">
                      Llama 3.2 3B Instruct
                    </option>
                    <option value="Llama-3.1-8B-Instruct-q4f32_1-MLC">
                      Llama 3.1 8B Instruct (Better Quality)
                    </option>
                    <option value="Phi-3.5-mini-instruct-q4f32_1-MLC">
                      Phi 3.5 Mini Instruct
                    </option>
                    <option value="gemma-2-2b-it-q4f32_1-MLC">
                      Gemma 2 2B Instruct
                    </option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-2">
                    Running locally in your browser with WebLLM
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium block mb-2">
                      OpenRouter API Key
                    </label>
                    <input
                      className="w-full p-3 border rounded-md bg-background text-sm"
                      type="password"
                      placeholder="Enter your OpenRouter API key"
                      value={openRouterApiKey}
                      onChange={(e) => setOpenRouterApiKey(e.target.value)}
                      disabled={modelStatus === 'loading'}
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        id="remember-key"
                        type="checkbox"
                        checked={rememberApiKey}
                        onChange={(e) => setRememberApiKey(e.target.checked)}
                      />
                      <label
                        htmlFor="remember-key"
                        className="text-xs text-muted-foreground"
                      >
                        Remember key in this browser
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-2">
                      Model
                    </label>
                    <input
                      className="w-full p-3 border rounded-md bg-background text-sm"
                      type="text"
                      placeholder="e.g. openrouter/auto or anthropic/claude-3.5-sonnet"
                      value={openRouterModel}
                      onChange={(e) => setOpenRouterModel(e.target.value)}
                      disabled={modelStatus === 'loading'}
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Uses OpenAI-compatible API at openrouter.ai
                    </p>
                  </div>
                </div>
              )}

              {/* Model Status */}
              <div className="flex items-start gap-3">
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-300 flex-shrink-0 mt-1 ${
                    modelStatus === 'idle'
                      ? 'bg-gray-400'
                      : modelStatus === 'loading'
                        ? 'bg-yellow-400 animate-pulse'
                        : modelStatus === 'ready'
                          ? 'bg-green-400'
                          : 'bg-red-400'
                  }`}
                />
                <div className="text-sm flex-1 leading-relaxed">
                  {modelStatus === 'idle' ? (
                    providerType === 'webllm' ? (
                      'Ready to load model'
                    ) : (
                      'Ready to connect'
                    )
                  ) : modelStatus === 'loading' ? (
                    <div className="space-y-1">
                      <div className="font-medium">Loading Model...</div>
                      <div className="text-muted-foreground text-xs whitespace-pre-wrap">
                        {loadingText}
                      </div>
                    </div>
                  ) : modelStatus === 'ready' ? (
                    <div className="space-y-1">
                      <div className="font-medium text-green-700 dark:text-green-300">
                        {providerType === 'webllm'
                          ? 'Model Ready'
                          : 'Connected'}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {providerType === 'webllm'
                          ? `${selectedModel} loaded and ready to use`
                          : `${openRouterModel} ready`}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="font-medium text-red-700 dark:text-red-300">
                        Failed to load model
                      </div>
                      <div className="text-muted-foreground text-xs whitespace-pre-wrap">
                        {loadingText}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {modelStatus === 'loading' && (
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${loadingProgress}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {loadingProgress}%
                  </div>
                </div>
              )}

              {/* Load/Connect Button */}
              <div className="pt-4 border-t">
                <Button
                  onClick={loadModel}
                  disabled={modelStatus === 'loading'}
                  className="w-full bg-blue-600 hover:bg-blue-700 py-3"
                  variant={modelStatus === 'ready' ? 'outline' : 'default'}
                >
                  {modelStatus === 'loading' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {providerType === 'webllm'
                        ? 'Loading Model...'
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

              {/* About Section */}
              <div className="pt-6 border-t space-y-4">
                <h3 className="font-semibold text-lg leading-tight">
                  Notebook-style prompt engineering
                </h3>
                <div className="text-sm text-muted-foreground space-y-3">
                  <p>
                    <span className="font-medium">
                      Build and test signatures interactively.
                    </span>{' '}
                    Create multiple cells to experiment with different prompts
                    and see results side by side.
                  </p>
                  <p>
                    Each cell contains a complete signature with inputs,
                    validation, execution, and results—just like a Jupyter
                    notebook for LLM development.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
