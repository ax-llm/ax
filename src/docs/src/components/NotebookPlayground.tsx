import { Loader2, Plus, Save, Share } from 'lucide-react';
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
      id: `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content: 'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
      createdAt: new Date(),
    },
  ]);
  
  // Global state for cell outputs and execution order
  const [cellStates, setCellStates] = useState<Record<string, CellState>>({});
  const [executionCounter, setExecutionCounter] = useState(0);
  
  // Track parsed signatures for all cells to get available output fields
  const [cellSignatures, setCellSignatures] = useState<Record<string, any>>({});
  
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Llama-3.2-1B-Instruct-q4f32_1-MLC');
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('');
  const [loadedEngine, setLoadedEngine] = useState<any>(null);
  const [loadedAI, setLoadedAI] = useState<any>(null);

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

  // Reset model status when model selection changes
  useEffect(() => {
    if (modelStatus === 'ready') {
      setModelStatus('idle');
      setLoadedEngine(null);
      setLoadedAI(null);
      setLoadingProgress(0);
      setLoadingText('Ready to load model');
    }
  }, [selectedModel]);

  const generateCellId = useCallback(() => {
    return `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  const addCell = useCallback((afterCellId?: string) => {
    const newCell: Cell = {
      id: generateCellId(),
      content: 'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
      createdAt: new Date(),
    };

    setCells(prev => {
      if (afterCellId) {
        const index = prev.findIndex(cell => cell.id === afterCellId);
        const newCells = [...prev];
        newCells.splice(index + 1, 0, newCell);
        return newCells;
      } else {
        return [...prev, newCell];
      }
    });
  }, [generateCellId]);

  const deleteCell = useCallback((cellId: string) => {
    setCells(prev => prev.filter(cell => cell.id !== cellId));
    // Clean up cell state when cell is deleted
    setCellStates(prev => {
      const { [cellId]: deleted, ...rest } = prev;
      return rest;
    });
  }, []);

  const loadExample = useCallback((signature: string) => {
    const newCell: Cell = {
      id: generateCellId(),
      content: signature,
      createdAt: new Date(),
    };
    setCells(prev => [...prev, newCell]);
  }, [generateCellId]);

  const loadModel = useCallback(async () => {
    setModelStatus('loading');
    setLoadingProgress(0);
    setLoadingText('Checking WebLLM availability...');
    
    try {
      // Check if we're in a browser environment
      if (typeof window === 'undefined') {
        throw new Error('WebLLM requires a browser environment');
      }

      setLoadingText('Loading WebLLM library...');
      console.log('Attempting to import WebLLM...');
      
      // Import WebLLM exactly like the working example
      const { MLCEngine } = await import('@mlc-ai/web-llm');
      const { AxAI } = await import('@ax-llm/ax');
      
      console.log('WebLLM MLCEngine loaded:', MLCEngine);
      console.log('AxAI loaded:', AxAI);

      setLoadingText('Creating WebLLM engine...');
      console.log('Creating WebLLM engine with model:', selectedModel);
      
      // Initialize WebLLM engine exactly like the working example
      const engine = new MLCEngine();
      
      // Set up progress callback exactly like the working example
      engine.setInitProgressCallback((progress: any) => {
        console.log('Loading progress:', progress);
        const percentage = Math.round(progress.progress * 100);
        setLoadingProgress(percentage);
        setLoadingText(`${progress.text} (${percentage}%)`);
      });
      
      // Load the selected model exactly like the working example
      await engine.reload(selectedModel);
      console.log('Model loaded, engine methods:', Object.getOwnPropertyNames(engine));
      console.log('Engine chat methods:', Object.getOwnPropertyNames(engine.chat || {}));
      console.log('Engine completions methods:', Object.getOwnPropertyNames(engine.chat?.completions || {}));
      
      setLoadingText('Creating Ax AI instance...');
      
      // Initialize Ax AI with WebLLM exactly like the working example
      console.log('Creating AxAI instance with engine:', engine);
      const ai = new AxAI({
        name: 'webllm',
        engine: engine,
        config: {
          model: selectedModel,
          stream: false
        }
      });
      console.log('AxAI instance created:', ai);
      
      setLoadedEngine(engine);
      setLoadedAI(ai);
      setModelStatus('ready');
      setLoadingProgress(100);
      
    } catch (error) {
      console.error('Detailed error loading model:', error);
      setModelStatus('error');
      
      // Provide more specific error messages
      let errorMessage = 'Failed to load model';
      if (error instanceof Error) {
        if (error.message.includes('WebLLM')) {
          errorMessage = `WebLLM library error: ${error.message}`;
        } else if (error.message.includes('worker')) {
          errorMessage = 'Web Worker error: ' + error.message;
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          errorMessage = 'Network error loading model';
        } else {
          errorMessage = error.message;
        }
      }
      
      setLoadingText(errorMessage);
    }
  }, [selectedModel]);

  // Update cell signature when parsed
  const updateCellSignature = useCallback((cellId: string, signature: any) => {
    setCellSignatures(prev => ({
      ...prev,
      [cellId]: signature
    }));
  }, []);

  // Update cell outputs when execution completes
  const updateCellState = useCallback((cellId: string, outputs: Record<string, any>) => {
    setExecutionCounter(prev => prev + 1);
    setCellStates(prev => ({
      ...prev,
      [cellId]: {
        outputs,
        executionOrder: executionCounter + 1
      }
    }));
  }, [executionCounter]);

  // Get available outputs from previous cells for input selection
  const getAvailableOutputs = useCallback((currentCellId: string) => {
    const currentCellIndex = cells.findIndex(cell => cell.id === currentCellId);
    const availableOutputs: Array<{ cellId: string, fieldName: string, value: any, cellIndex: number }> = [];
    
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
              value: actualValue !== undefined ? actualValue : `<not yet executed>`,
              cellIndex: i
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
              cellIndex: i
            });
          });
        }
      }
    }
    
    return availableOutputs.sort((a, b) => a.cellIndex - b.cellIndex);
  }, [cells, cellStates, cellSignatures]);

  return (
    <div className="flex h-screen bg-background">
      {/* Left Sidebar - Examples */}
      <div className="w-80 border-r bg-muted/30 p-6 overflow-y-auto">
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-3">Example Templates</h3>
            <div className="space-y-2">
              {EXAMPLE_SIGNATURES.map((example, index) => (
                <button
                  key={index}
                  onClick={() => loadExample(example.signature)}
                  className="w-full text-left p-3 rounded-lg border bg-background hover:bg-accent text-sm transition-colors"
                >
                  <div className="font-medium">{example.name}</div>
                  <div className="text-muted-foreground text-xs mt-1">{example.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-3">Notebook Actions</h3>
            <div className="space-y-2">
              <Button
                onClick={() => addCell()}
                variant="outline"
                className="w-full justify-start"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Cell
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                size="sm"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Notebook
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                size="sm"
              >
                <Share className="h-4 w-4 mr-2" />
                Share Notebook
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Toolbar */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">Notebook Playground</h1>
            <span className="text-sm text-muted-foreground">
              {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => addCell()}
              variant="outline"
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Cell
            </Button>
            <Button variant="outline" size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            <Button variant="outline" size="sm">
              <Share className="h-4 w-4 mr-2" />
              Share
            </Button>
          </div>
        </div>

        {/* Notebook Content */}
        <div className="flex-1 flex">
          {/* Cells Area */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-4xl mx-auto">
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
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Cell
                </Button>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Model Controls */}
          <div className="w-80 border-l bg-muted/30 p-6 space-y-6 overflow-y-auto">
            <div>
              <label className="text-sm font-medium block mb-3">Model</label>
              <select 
                className="w-full p-3 border rounded-md bg-background text-sm"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={modelStatus === 'loading'}
              >
                <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC">Llama 3.2 1B Instruct (Fastest - Default)</option>
                <option value="Llama-3.2-3B-Instruct-q4f32_1-MLC">Llama 3.2 3B Instruct</option>
                <option value="Llama-3.1-8B-Instruct-q4f32_1-MLC">Llama 3.1 8B Instruct (Better Quality)</option>
                <option value="Phi-3.5-mini-instruct-q4f32_1-MLC">Phi 3.5 Mini Instruct</option>
                <option value="gemma-2-2b-it-q4f32_1-MLC">Gemma 2 2B Instruct</option>
              </select>
              <p className="text-xs text-muted-foreground mt-2">
                Running locally in your browser with WebLLM
              </p>
            </div>

            {/* Model Status */}
            <div className="flex items-start gap-3">
              <div className={`w-3 h-3 rounded-full transition-all duration-300 flex-shrink-0 mt-1 ${
                modelStatus === 'idle' ? 'bg-gray-400' :
                modelStatus === 'loading' ? 'bg-yellow-400 animate-pulse' :
                modelStatus === 'ready' ? 'bg-green-400' :
                'bg-red-400'
              }`} />
              <div className="text-sm flex-1 leading-relaxed">
                {modelStatus === 'idle' ? 'Ready to load model' :
                 modelStatus === 'loading' ? (
                   <div className="space-y-1">
                     <div className="font-medium">Loading Model...</div>
                     <div className="text-muted-foreground text-xs whitespace-pre-wrap">{loadingText}</div>
                   </div>
                 ) :
                 modelStatus === 'ready' ? (
                   <div className="space-y-1">
                     <div className="font-medium text-green-700 dark:text-green-300">Model Ready</div>
                     <div className="text-muted-foreground text-xs">
                       {selectedModel} loaded and ready to use
                     </div>
                   </div>
                 ) :
                 <div className="space-y-1">
                   <div className="font-medium text-red-700 dark:text-red-300">Failed to load model</div>
                   <div className="text-muted-foreground text-xs whitespace-pre-wrap">{loadingText}</div>
                 </div>}
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
                <div className="text-xs text-muted-foreground">{loadingProgress}%</div>
              </div>
            )}

            {/* Load Model Button */}
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
                    Loading Model...
                  </>
                ) : modelStatus === 'ready' ? (
                  'Reload Model'
                ) : (
                  'Load Model'
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
                  <span className="font-medium">Build and test signatures interactively.</span> Create multiple cells to experiment
                  with different prompts and see results side by side.
                </p>
                <p>
                  Each cell contains a complete signature with inputs, validation, execution, and results—just like
                  a Jupyter notebook for LLM development.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}