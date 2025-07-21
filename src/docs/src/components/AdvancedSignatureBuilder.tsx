import {
  AlertCircle,
  CheckCircle,
  Copy,
  FileText,
  Lightbulb,
  Play,
  XCircle,
  Zap,
  Loader2,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAutocompleteItems } from '../lib/autocomplete';
import { parseSignature } from '../lib/signature-parser';
import {
  generateSyntaxHighlights,
  getSyntaxHighlightStyles,
  getSyntaxHighlightStylesDark,
} from '../lib/syntax-highlighter';
import type { AutocompleteItem, EditorState } from '../types/editor';
import TypeDropdown from './TypeDropdown';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const EXAMPLE_SIGNATURES = [
  {
    name: 'Sentiment Analysis',
    description: 'Analyze text sentiment with confidence',
    signature:
      'inputText:string "Text to analyze" -> sentimentCategory:class("positive", "negative", "neutral"), confidenceScore:number "Confidence 0-1"',
  },
  {
    name: 'Code Generation',
    description: 'Generate programming solutions',
    signature:
      'problemDescription:string "Programming problem to solve" -> pythonSolution:code("python") "Python code solution", solutionExplanation:string "Explanation of approach"',
  },
  {
    name: 'Data Extraction',
    description: 'Extract structured data from text',
    signature:
      '"Extract key information from customer feedback" customerFeedback:string "Customer feedback text" -> extractedTopics:string[] "Topics mentioned", urgencyLevel:class("low", "medium", "high"), actionItems?:string[] "Optional action items"',
  },
  {
    name: 'Question Answering',
    description: 'Answer questions from context',
    signature:
      'contextText:string "Context information", userQuestion:string "Question to answer" -> answer:string "Answer based on context", confidence:number "Answer confidence 0-1"',
  },
];

export default function AdvancedSignatureBuilder() {
  const [editorState, setEditorState] = useState<EditorState>({
    content:
      'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
    cursorPosition: 0,
    selection: { start: 0, end: 0 },
    parsedSignature: parseSignature(
      'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"'
    ),
    syntaxHighlights: [],
    autocompleteVisible: false,
    autocompleteItems: [],
    autocompletePosition: { line: 0, column: 0, offset: 0 },
    typeDropdownVisible: false,
    typeDropdownPosition: { x: 0, y: 0 },
    selectedOptional: false,
  });

  const [activeTab, setActiveTab] = useState('editor');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('Llama-3.2-3B-Instruct-q4f32_1-MLC');
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('');
  const [loadedEngine, setLoadedEngine] = useState<any>(null);
  const [loadedAI, setLoadedAI] = useState<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Parse signature and update highlights whenever content changes
  useEffect(() => {
    const parsedSignature = parseSignature(editorState.content);
    const syntaxHighlights = generateSyntaxHighlights(
      editorState.content,
      parsedSignature
    );

    setEditorState((prev) => ({
      ...prev,
      parsedSignature,
      syntaxHighlights,
    }));
  }, [editorState.content]);

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

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      const cursorPosition = e.target.selectionStart;

      setEditorState((prev) => ({
        ...prev,
        content: newContent,
        cursorPosition,
        selection: {
          start: e.target.selectionStart,
          end: e.target.selectionEnd,
        },
      }));
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const { key, ctrlKey, metaKey } = e;

      // Handle autocomplete
      if (key === 'Tab' && editorState.autocompleteVisible) {
        e.preventDefault();
        if (editorState.autocompleteItems.length > 0) {
          insertAutocomplete(editorState.autocompleteItems[0]);
        }
        return;
      }

      // Show autocomplete on Ctrl+Space
      if ((ctrlKey || metaKey) && key === ' ') {
        e.preventDefault();
        showAutocomplete();
        return;
      }

      // Hide autocomplete/dropdown on Escape
      if (key === 'Escape') {
        if (editorState.typeDropdownVisible) {
          hideTypeDropdown();
        } else {
          hideAutocomplete();
        }
        return;
      }

      // Auto-show autocomplete after typing certain characters
      setTimeout(() => {
        if (textareaRef.current) {
          const position = textareaRef.current.selectionStart;
          const shouldShowAutocomplete = shouldTriggerAutocomplete(
            editorState.content,
            position
          );

          if (shouldShowAutocomplete) {
            showAutocomplete();
          } else {
            hideAutocomplete();
          }
        }
      }, 100);
    },
    [editorState]
  );

  const shouldTriggerAutocomplete = (
    content: string,
    position: number
  ): boolean => {
    const beforeCursor = content.substring(0, position);

    // Show type dropdown after typing ":"
    if (beforeCursor.endsWith(':')) {
      showTypeDropdown();
      return false; // Don't show regular autocomplete
    }

    // Show after typing partial type names
    const lastWord = beforeCursor.split(/[\s,:()]+/).pop() || '';
    if (lastWord.length >= 2 && /^[a-z]/i.test(lastWord)) return true;

    // Show at beginning of field names
    const trimmed = beforeCursor.trim();
    if (trimmed === '' || trimmed.endsWith(',') || trimmed.endsWith('->'))
      return true;

    return false;
  };

  const showAutocomplete = useCallback(() => {
    if (!textareaRef.current) return;

    const position = textareaRef.current.selectionStart;
    const items = getAutocompleteItems(editorState.content, position);

    setEditorState((prev) => ({
      ...prev,
      autocompleteVisible: items.length > 0,
      autocompleteItems: items,
      autocompletePosition: { line: 0, column: position, offset: position },
    }));
  }, [editorState.content]);

  const hideAutocomplete = useCallback(() => {
    setEditorState((prev) => ({
      ...prev,
      autocompleteVisible: false,
      autocompleteItems: [],
    }));
  }, []);

  const showTypeDropdown = useCallback(() => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const rect = textarea.getBoundingClientRect();
    const position = textarea.selectionStart;

    // Calculate cursor position in textarea
    const lines = editorState.content.substring(0, position).split('\n');
    const currentLine = lines.length - 1;
    const currentColumn = lines[lines.length - 1].length;

    // Approximate positioning (this is a simplified calculation)
    const lineHeight = 24; // 1.5rem in pixels
    const charWidth = 8.4; // Approximate character width for monospace

    const x = rect.left + currentColumn * charWidth + 16; // 16px for padding
    const y = rect.top + currentLine * lineHeight + lineHeight + 16; // Position below current line

    // Determine if we're in an input field context
    const beforeCursor = editorState.content.substring(0, position);
    const _isInputField =
      !beforeCursor.includes('->') ||
      beforeCursor.lastIndexOf('->') < beforeCursor.lastIndexOf(',');

    setEditorState((prev) => ({
      ...prev,
      typeDropdownVisible: true,
      typeDropdownPosition: { x, y },
      autocompleteVisible: false, // Hide regular autocomplete
    }));
  }, [editorState.content]);

  const hideTypeDropdown = useCallback(() => {
    setEditorState((prev) => ({
      ...prev,
      typeDropdownVisible: false,
    }));
  }, []);

  const handleTypeSelect = useCallback(
    (type: string, _isOptional: boolean, _isArrayy: boolean) => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const position = textarea.selectionStart;

      const newContent =
        editorState.content.substring(0, position) +
        type +
        editorState.content.substring(position);

      const newCursorPosition = position + type.length;

      setEditorState((prev) => ({
        ...prev,
        content: newContent,
        cursorPosition: newCursorPosition,
        typeDropdownVisible: false,
      }));

      // Set cursor position and focus
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPosition;
          textareaRef.current.selectionEnd = newCursorPosition;
          textareaRef.current.focus();
        }
      }, 0);
    },
    [editorState.content]
  );

  const insertAutocomplete = useCallback(
    (item: AutocompleteItem) => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      // Find the start of the current word
      let wordStart = start;
      while (
        wordStart > 0 &&
        /[a-zA-Z0-9_]/.test(editorState.content[wordStart - 1])
      ) {
        wordStart--;
      }

      const newContent =
        editorState.content.substring(0, wordStart) +
        item.insertText +
        editorState.content.substring(end);

      const newCursorPosition = wordStart + item.insertText.length;

      setEditorState((prev) => ({
        ...prev,
        content: newContent,
        cursorPosition: newCursorPosition,
        autocompleteVisible: false,
        autocompleteItems: [],
      }));

      // Set cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPosition;
          textareaRef.current.selectionEnd = newCursorPosition;
          textareaRef.current.focus();
        }
      }, 0);
    },
    [editorState.content]
  );

  const loadExample = useCallback((signature: string) => {
    setEditorState((prev) => ({
      ...prev,
      content: signature,
      cursorPosition: signature.length,
      selection: { start: signature.length, end: signature.length },
      autocompleteVisible: false,
      typeDropdownVisible: false,
    }));

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(
          signature.length,
          signature.length
        );
      }
    }, 0);
  }, []);

  const generateCode = useCallback(() => {
    const { parsedSignature } = editorState;
    if (!parsedSignature.valid) return '';

    const inputParts = parsedSignature.inputFields.map((field) => {
      let fieldDef = `${field.name}:\${f.${field.type}('${field.description || field.name}')}`;

      if (field.type === 'class' && field.classOptions) {
        const options = field.classOptions.map((opt) => `'${opt}'`).join(', ');
        fieldDef = `${field.name}:\${f.class([${options}], '${field.description || 'Classification'}')}`;
      } else if (field.isArray) {
        const baseType =
          field.type === 'class'
            ? `f.class([${field.classOptions?.map((opt) => `'${opt}'`).join(', ')}], '${field.description}')`
            : `f.${field.type}('${field.description}')`;
        fieldDef = `${field.name}:\${f.array(${baseType})}`;
      } else if (field.type === 'code' && field.codeLanguage) {
        fieldDef = `${field.name}:\${f.code('${field.codeLanguage}', '${field.description || 'Code block'}')}`;
      }

      if (field.isOptional) {
        fieldDef = fieldDef
          .replace(':${', ':${f.optional(')
          .replace(')}', '))}');
      }
      if (field.isInternal) {
        fieldDef = fieldDef
          .replace(':${', ':${f.internal(')
          .replace(')}', '))}');
      }

      return fieldDef;
    });

    const outputParts = parsedSignature.outputFields.map((field) => {
      let fieldDef = `${field.name}:\${f.${field.type}('${field.description || field.name}')}`;

      if (field.type === 'class' && field.classOptions) {
        const options = field.classOptions.map((opt) => `'${opt}'`).join(', ');
        fieldDef = `${field.name}:\${f.class([${options}], '${field.description || 'Classification'}')}`;
      } else if (field.isArray) {
        const baseType =
          field.type === 'class'
            ? `f.class([${field.classOptions?.map((opt) => `'${opt}'`).join(', ')}], '${field.description}')`
            : `f.${field.type}('${field.description}')`;
        fieldDef = `${field.name}:\${f.array(${baseType})}`;
      } else if (field.type === 'code' && field.codeLanguage) {
        fieldDef = `${field.name}:\${f.code('${field.codeLanguage}', '${field.description || 'Code block'}')}`;
      }

      if (field.isOptional) {
        fieldDef = fieldDef
          .replace(':${', ':${f.optional(')
          .replace(')}', '))}');
      }
      if (field.isInternal) {
        fieldDef = fieldDef
          .replace(':${', ':${f.internal(')
          .replace(')}', '))}');
      }

      return fieldDef;
    });

    const signatureParts = [...inputParts, '->', ...outputParts].join(',\n  ');

    return `// ${parsedSignature.description || 'Generated signature'}
const mySignature = ax\`
  ${signatureParts}
\`;`;
  }, [editorState.parsedSignature]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const loadModel = useCallback(async () => {
    setModelStatus('loading');
    setLoadingProgress(0);
    setLoadingText('Initializing...');
    setExecutionError(null);
    
    try {
      // Import WebLLM and Ax dynamically
      const [{ CreateWebWorkerMLCEngine }, { AxAI }] = await Promise.all([
        import('@mlc-ai/web-llm'),
        import('@ax-llm/ax')
      ]);
      
      // Initialize WebLLM engine with progress callback
      const engine = await CreateWebWorkerMLCEngine(
        new Worker(
          new URL('@mlc-ai/web-llm/lib/webllm_lib.worker.js', import.meta.url),
          { type: 'module' }
        ),
        selectedModel,
        {
          initProgressCallback: (progress) => {
            const percentage = Math.round(progress.progress * 100);
            setLoadingProgress(percentage);
            setLoadingText(`${progress.text} (${percentage}%)`);
          }
        }
      );
      
      // Create Ax AI instance with the loaded engine
      const ai = new AxAI({
        name: 'webllm',
        engine: engine,
        config: {
          model: selectedModel,
          stream: false
        }
      });
      
      setLoadedEngine(engine);
      setLoadedAI(ai);
      setModelStatus('ready');
      setLoadingText('Model loaded and ready!');
      
    } catch (error) {
      console.error('Failed to load model:', error);
      setModelStatus('error');
      setExecutionError(error instanceof Error ? error.message : 'Failed to load model');
      setLoadingText('Failed to load model');
    }
  }, [selectedModel]);

  const executeSignature = useCallback(async () => {
    if (!editorState.parsedSignature.valid || !loadedAI || modelStatus !== 'ready') return;
    
    setIsExecuting(true);
    setExecutionError(null);
    setExecutionResult(null);
    
    try {
      // Import Ax dynamically for template literals
      const { ax, f } = await import('@ax-llm/ax');
      
      // Create signature using template literal syntax
      const { parsedSignature } = editorState;
      
      // Build the signature dynamically
      const inputParts = parsedSignature.inputFields.map(field => {
        let fieldDef = `${field.name}:\${f.${field.type}('${field.description || field.name}')}`;
        
        if (field.type === 'class' && field.classOptions) {
          const options = field.classOptions.map(opt => `'${opt}'`).join(', ');
          fieldDef = `${field.name}:\${f.class([${options}], '${field.description || 'Classification'}')}`;
        } else if (field.isArray) {
          const baseType = field.type === 'class' 
            ? `f.class([${field.classOptions?.map(opt => `'${opt}'`).join(', ')}], '${field.description}')` 
            : `f.${field.type}('${field.description}')`;
          fieldDef = `${field.name}:\${f.array(${baseType})}`;
        } else if (field.type === 'code' && field.codeLanguage) {
          fieldDef = `${field.name}:\${f.code('${field.codeLanguage}', '${field.description || 'Code block'}')}`;
        }
        
        if (field.isOptional) {
          fieldDef = fieldDef.replace(':${', ':${f.optional(').replace(')}', '))}');
        }
        if (field.isInternal) {
          fieldDef = fieldDef.replace(':${', ':${f.internal(').replace(')}', '))}');
        }
        
        return fieldDef;
      });
      
      const outputParts = parsedSignature.outputFields.map(field => {
        let fieldDef = `${field.name}:\${f.${field.type}('${field.description || field.name}')}`;
        
        if (field.type === 'class' && field.classOptions) {
          const options = field.classOptions.map(opt => `'${opt}'`).join(', ');
          fieldDef = `${field.name}:\${f.class([${options}], '${field.description || 'Classification'}')}`;
        } else if (field.isArray) {
          const baseType = field.type === 'class' 
            ? `f.class([${field.classOptions?.map(opt => `'${opt}'`).join(', ')}], '${field.description}')` 
            : `f.${field.type}('${field.description}')`;
          fieldDef = `${field.name}:\${f.array(${baseType})}`;
        } else if (field.type === 'code' && field.codeLanguage) {
          fieldDef = `${field.name}:\${f.code('${field.codeLanguage}', '${field.description || 'Code block'}')}`;
        }
        
        if (field.isOptional) {
          fieldDef = fieldDef.replace(':${', ':${f.optional(').replace(')}', '))}');
        }
        if (field.isInternal) {
          fieldDef = fieldDef.replace(':${', ':${f.internal(').replace(')}', '))}');
        }
        
        return fieldDef;
      });
      
      // Create the signature by evaluating the template
      const signatureCode = `ax\`${[...inputParts, '->', ...outputParts].join(',\n  ')}\``;
      const signature = eval(`(${signatureCode})`);
      
      // Prepare input data
      const inputData: Record<string, any> = {};
      parsedSignature.inputFields.forEach(field => {
        let value = inputValues[field.name] || '';
        
        // Type conversion based on field type
        if (field.type === 'number') {
          value = parseFloat(value) || 0;
        } else if (field.type === 'boolean') {
          value = value.toLowerCase() === 'true' || value === '1';
        } else if (field.isArray) {
          value = value.split(',').map(v => v.trim()).filter(Boolean);
        }
        
        inputData[field.name] = value;
      });
      
      // Execute the signature with the loaded AI
      const result = await signature.forward(loadedAI, inputData);
      setExecutionResult(result);
      
    } catch (error) {
      console.error('Execution error:', error);
      setExecutionError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsExecuting(false);
    }
  }, [editorState.parsedSignature, inputValues, loadedAI, modelStatus]);

  const renderStatusBar = () => {
    const { parsedSignature } = editorState;
    const errorCount = parsedSignature.errors.length;
    const warningCount = parsedSignature.warnings.length;

    if (parsedSignature.valid && warningCount === 0) {
      return (
        <div className="flex items-center gap-2 border-green-200 border-b bg-green-50 px-4 py-2 dark:border-green-800 dark:bg-green-900/20">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          <span className="font-medium text-green-700 text-sm dark:text-green-300">
            Signature is valid
          </span>
          <Badge
            variant="secondary"
            className="ml-auto border-transparent bg-green-700 text-white hover:bg-green-800"
          >
            {parsedSignature.inputFields.length} inputs,{' '}
            {parsedSignature.outputFields.length} outputs
          </Badge>
        </div>
      );
    }

    const primaryIssue =
      errorCount > 0 ? parsedSignature.errors[0] : parsedSignature.warnings[0];
    const Icon = errorCount > 0 ? XCircle : AlertCircle;
    const colorClass =
      errorCount > 0
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
        : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300';

    return (
      <div
        className={`flex items-center gap-2 border-b px-4 py-2 ${colorClass}`}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 font-medium text-sm">
          {primaryIssue.message}
        </span>
        {primaryIssue.suggestion && (
          <div className="flex items-center gap-1 text-xs">
            <Lightbulb className="h-3 w-3" />
            <span>{primaryIssue.suggestion}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
            </Badge>
          )}
        </div>
      </div>
    );
  };

  const renderHighlightedContent = () => {
    const styles = isDarkMode
      ? getSyntaxHighlightStylesDark()
      : getSyntaxHighlightStyles();
    const { content, syntaxHighlights } = editorState;

    if (syntaxHighlights.length === 0) {
      return <span>{content}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastEnd = 0;

    syntaxHighlights.forEach((highlight, index) => {
      // Add text before highlight
      if (highlight.start > lastEnd) {
        elements.push(
          <span key={`text-${index}`}>
            {content.substring(lastEnd, highlight.start)}
          </span>
        );
      }

      // Add highlighted text
      elements.push(
        <span
          key={`highlight-${index}`}
          style={
            styles[highlight.type]
              ? { color: styles[highlight.type].match(/color:\s*([^;]+)/)?.[1] }
              : undefined
          }
          className={
            highlight.type === 'error'
              ? 'bg-red-100 underline decoration-wavy dark:bg-red-900/30'
              : ''
          }
        >
          {highlight.text}
        </span>
      );

      lastEnd = highlight.end;
    });

    // Add remaining text
    if (lastEnd < content.length) {
      elements.push(<span key="text-end">{content.substring(lastEnd)}</span>);
    }

    return <>{elements}</>;
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Left Sidebar - Examples */}
      <div className="w-80 border-r bg-muted/30 p-6 overflow-y-auto">
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
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Toolbar */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">Playground</h1>
            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Load a preset...
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">Save</Button>
            <Button variant="outline" size="sm">View code</Button>
            <Button variant="outline" size="sm">Share</Button>
            <Button variant="outline" size="sm">⋯</Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex">
          {/* Main Editor Area */}
          <div className="flex-1 flex flex-col">
            {/* Status Bar */}
            {renderStatusBar()}
            
            {/* Signature Editor */}
            <div className="flex-1 p-6">
              <div className="h-full flex flex-col space-y-4">
                <div className="relative flex-1">
                  <div className="relative h-full overflow-hidden rounded-lg border bg-background">
                    {/* Syntax highlighting overlay */}
                    <div
                      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap p-4 font-mono text-sm"
                      style={{
                        color: 'transparent',
                        lineHeight: '1.5rem',
                        fontSize: '14px',
                      }}
                    >
                      {renderHighlightedContent()}
                    </div>

                    {/* Actual textarea */}
                    <textarea
                      ref={textareaRef}
                      value={editorState.content}
                      onChange={handleContentChange}
                      onKeyDown={handleKeyDown}
                      onBlur={hideAutocomplete}
                      className="relative h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-sm outline-none"
                      style={{
                        lineHeight: '1.5rem',
                        fontSize: '14px',
                        color: isDarkMode ? '#e6edf3' : '#24292f',
                      }}
                      placeholder="Enter your signature here... (Ctrl/Cmd+Space for autocomplete)"
                      spellCheck={false}
                    />

                    {/* Autocomplete dropdown */}
                    {editorState.autocompleteVisible && (
                      <div
                        ref={autocompleteRef}
                        className="absolute z-10 mt-1 max-h-64 min-w-80 overflow-y-auto rounded-lg border bg-popover shadow-lg"
                        style={{
                          top: '100%',
                          left: '1rem',
                        }}
                      >
                        {editorState.autocompleteItems.map((item, index) => (
                          <div
                            key={index}
                            className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-accent"
                            onClick={() => insertAutocomplete(item)}
                          >
                            <div className="flex-1">
                              <div className="font-medium text-sm">
                                {item.label}
                              </div>
                              {item.detail && (
                                <div className="text-muted-foreground text-xs">
                                  {item.detail}
                                </div>
                              )}
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {item.kind}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Type dropdown */}
                <TypeDropdown
                  visible={editorState.typeDropdownVisible}
                  position={editorState.typeDropdownPosition}
                  onSelect={handleTypeSelect}
                  onClose={hideTypeDropdown}
                  isInputField={(() => {
                    const beforeCursor = editorState.content.substring(
                      0,
                      editorState.cursorPosition
                    );
                    return (
                      !beforeCursor.includes('->') ||
                      beforeCursor.lastIndexOf('->') <
                        beforeCursor.lastIndexOf(',')
                    );
                  })()}
                />

                {/* Input Form - only show when signature is valid */}
                {editorState.parsedSignature.valid && editorState.parsedSignature.inputFields.length > 0 && (
                  <div className="border-t pt-4 space-y-4">
                    <h3 className="font-medium">Test Inputs</h3>
                    {editorState.parsedSignature.inputFields.map((field) => (
                      <div key={field.name} className="space-y-2">
                        <label className="text-sm font-medium" htmlFor={field.name}>
                          {field.name}
                          {field.isOptional && <span className="text-muted-foreground"> (optional)</span>}
                        </label>
                        <div className="text-xs text-muted-foreground">
                          {field.type}{field.isArray && '[]'}{field.classOptions && ` (${field.classOptions.join(', ')})`}
                        </div>
                        {field.type === 'string' && field.name.toLowerCase().includes('text') ? (
                          <Textarea
                            id={field.name}
                            placeholder={field.description || `Enter ${field.name}`}
                            value={inputValues[field.name] || ''}
                            onChange={(e) => 
                              setInputValues(prev => ({ ...prev, [field.name]: e.target.value }))
                            }
                            className="min-h-[60px]"
                          />
                        ) : (
                          <Input
                            id={field.name}
                            type={field.type === 'number' ? 'number' : 'text'}
                            placeholder={
                              field.classOptions 
                                ? `Choose from: ${field.classOptions.join(', ')}`
                                : field.isArray 
                                  ? 'Enter comma-separated values'
                                  : field.description || `Enter ${field.name}`
                            }
                            value={inputValues[field.name] || ''}
                            onChange={(e) => 
                              setInputValues(prev => ({ ...prev, [field.name]: e.target.value }))
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Results Display */}
                {(executionResult || executionError) && (
                  <div className="border-t pt-4 space-y-4">
                    <h3 className="font-medium">
                      {executionError ? 'Error' : 'Result'}
                    </h3>
                    {executionError ? (
                      <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
                        <p className="text-destructive text-sm">{executionError}</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {editorState.parsedSignature.outputFields.map((field) => (
                          <div key={field.name} className="space-y-1">
                            <div className="text-sm font-medium">{field.name}</div>
                            <div className="rounded-md border bg-muted/50 p-3 text-sm">
                              {typeof executionResult?.[field.name] === 'object' 
                                ? JSON.stringify(executionResult[field.name], null, 2)
                                : String(executionResult?.[field.name] || 'No result')
                              }
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Sidebar - Model Selection */}
          <div className="w-80 border-l bg-muted/30 p-6 space-y-6 overflow-y-auto">
            <div>
              <label className="text-sm font-medium block mb-3">Model</label>
              <select 
                className="w-full p-3 border rounded-md bg-background text-sm"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={modelStatus === 'loading'}
              >
                <option value="Llama-3.2-3B-Instruct-q4f32_1-MLC">Llama 3.2 3B Instruct (Default)</option>
                <option value="Llama-3.2-1B-Instruct-q4f32_1-MLC">Llama 3.2 1B Instruct (Fastest)</option>
                <option value="Llama-3.1-8B-Instruct-q4f32_1-MLC">Llama 3.1 8B Instruct (Better Quality)</option>
                <option value="Phi-3.5-mini-instruct-q4f32_1-MLC">Phi 3.5 Mini Instruct</option>
                <option value="gemma-2-2b-it-q4f32_1-MLC">Gemma 2 2B Instruct</option>
              </select>
              <p className="text-xs text-muted-foreground mt-2">
                Running locally in your browser with WebLLM
              </p>
            </div>

            {/* Model Status */}
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full transition-all duration-300 ${
                modelStatus === 'idle' ? 'bg-gray-400' :
                modelStatus === 'loading' ? 'bg-yellow-400 animate-pulse' :
                modelStatus === 'ready' ? 'bg-green-400' :
                'bg-red-400'
              }`} />
              <span className="text-sm flex-1">
                {modelStatus === 'idle' ? 'Ready to load model' :
                 modelStatus === 'loading' ? loadingText :
                 modelStatus === 'ready' ? 'Model loaded and ready!' :
                 'Failed to load model'}
              </span>
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

            {/* Load Model / Submit Button */}
            <div className="pt-4 border-t space-y-3">
              {modelStatus === 'ready' ? (
                <>
                  <Button 
                    onClick={executeSignature}
                    disabled={isExecuting || !editorState.parsedSignature.valid}
                    className="w-full bg-green-600 hover:bg-green-700 py-3"
                  >
                    {isExecuting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Executing...
                      </>
                    ) : (
                      'Submit'
                    )}
                  </Button>
                  {editorState.parsedSignature.valid && editorState.parsedSignature.inputFields.length > 0 && (
                    <p className="text-xs text-muted-foreground text-center">
                      Fill in the input fields below to test your signature
                    </p>
                  )}
                </>
              ) : (
                <Button 
                  onClick={loadModel}
                  disabled={modelStatus === 'loading'}
                  className="w-full bg-blue-600 hover:bg-blue-700 py-3"
                >
                  {modelStatus === 'loading' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading Model...
                    </>
                  ) : (
                    'Load Model'
                  )}
                </Button>
              )}
            </div>

            {/* About Ax */}
            <div className="pt-6 border-t space-y-4">
              <h3 className="font-semibold text-lg leading-tight">
                Build LLM-powered agents<br />
                with production-ready TypeScript
              </h3>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  <span className="font-medium">DSPy for TypeScript.</span> Working with LLMs is complex—they don't always
                  do what you want. DSPy makes it easier to build amazing things with LLMs.
                </p>
                <p>
                  Just define your inputs and outputs (signature) and an efficient prompt is auto-generated
                  and used. Connect together various signatures to build complex systems and
                  workflows using LLMs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
