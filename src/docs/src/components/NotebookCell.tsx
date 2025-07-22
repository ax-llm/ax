import {
  AlertCircle,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Play,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import CellOutputSelector from './CellOutputSelector';
import TypeDropdown from './TypeDropdown';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface AvailableOutput {
  cellId: string;
  fieldName: string;
  value: any;
  cellIndex: number;
}

interface NotebookCellProps {
  cellId: string;
  initialContent?: string;
  loadedAI?: any;
  modelStatus: 'idle' | 'loading' | 'ready' | 'error';
  isDarkMode: boolean;
  onDelete?: (cellId: string) => void;
  onAddCell?: (afterCellId: string) => void;
  onUpdateCellState?: (cellId: string, outputs: Record<string, any>) => void;
  onUpdateCellSignature?: (cellId: string, signature: any) => void;
  availableOutputs?: AvailableOutput[];
}

export default function NotebookCell({
  cellId,
  initialContent = 'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
  loadedAI,
  modelStatus,
  isDarkMode: _isDarkMode,
  onDelete,
  onAddCell,
  onUpdateCellState,
  onUpdateCellSignature,
  availableOutputs = [],
}: NotebookCellProps) {
  const [content, setContent] = useState(initialContent);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [axSignature, setAxSignature] = useState<any>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [typeDropdownVisible, setTypeDropdownVisible] = useState(false);
  const [typeDropdownPosition, setTypeDropdownPosition] = useState({
    x: 0,
    y: 0,
  });

  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Parse signature with AxSignature whenever content changes
  useEffect(() => {
    const parseSignature = async () => {
      try {
        if (!content.trim()) {
          setAxSignature(null);
          setSignatureError(null);
          onUpdateCellSignature?.(cellId, null);
          return;
        }

        const { AxSignature } = await import('@ax-llm/ax');
        const signature = new AxSignature(content);
        setAxSignature(signature);
        setSignatureError(null);

        // Notify parent component of parsed signature
        onUpdateCellSignature?.(cellId, signature);
      } catch (error) {
        console.error('Signature parsing error:', error);
        setAxSignature(null);
        setSignatureError(
          error instanceof Error ? error.message : 'Invalid signature'
        );
        onUpdateCellSignature?.(cellId, null);
      }
    };

    parseSignature();
  }, [content, cellId, onUpdateCellSignature]);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setContent(newContent);
      setCursorPosition(e.target.selectionStart);
    },
    []
  );

  const showTypeDropdown = useCallback(() => {
    console.log('showTypeDropdown called');
    if (!textareaRef.current) {
      console.log('textareaRef.current is null');
      return;
    }

    const textarea = textareaRef.current;
    const rect = textarea.getBoundingClientRect();
    const position = textarea.selectionStart;

    // Calculate cursor position in textarea
    const lines = content.substring(0, position).split('\n');
    const currentLine = lines.length - 1;
    const currentColumn = lines[lines.length - 1].length;

    // Approximate positioning
    const lineHeight = 24;
    const charWidth = 8.4;

    const x = rect.left + currentColumn * charWidth + 16;
    const y = rect.top + currentLine * lineHeight + lineHeight + 16;

    console.log('Setting dropdown visible with position:', { x, y });
    setTypeDropdownVisible(true);
    setTypeDropdownPosition({ x, y });
  }, [content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const { key } = e;

      // Hide dropdown on Escape
      if (key === 'Escape') {
        setTypeDropdownVisible(false);
        return;
      }

      // Show type dropdown when ":" is typed
      if (key === ':') {
        console.log('Colon key pressed, showing type dropdown');
        // Use requestAnimationFrame instead of setTimeout for better timing
        requestAnimationFrame(() => {
          showTypeDropdown();
        });
      }
    },
    [showTypeDropdown]
  );

  const hideTypeDropdown = useCallback(() => {
    setTypeDropdownVisible(false);
  }, []);

  const hideTypeDropdownDelayed = useCallback(() => {
    // Add a small delay to allow click events on the dropdown to process first
    setTimeout(() => {
      setTypeDropdownVisible(false);
    }, 150);
  }, []);

  const handleTypeSelect = useCallback(
    (type: string, isOptional: boolean, _isArray: boolean) => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const position = textarea.selectionStart;
      const beforeCursor = content.substring(0, position);

      // The type already comes with : prefix, so we need to handle optional placement correctly
      let newContent = content;
      let newCursorPosition = position;

      // Check if there's already a colon at the cursor position or just before
      const colonIndex = beforeCursor.lastIndexOf(':');

      if (colonIndex !== -1 && colonIndex === position - 1) {
        // We're right after a colon, replace what comes after
        let currentPosition = position;
        const afterColon = content.substring(currentPosition);
        const typeEndMatch = afterColon.match(/[,\->"]/);
        let typeEnd = typeEndMatch
          ? currentPosition + (typeEndMatch.index ?? 0)
          : content.length;

        // Handle optional marker - place it before the colon
        if (isOptional) {
          const beforeColonChar = content.charAt(colonIndex - 1);
          if (beforeColonChar !== '?') {
            newContent = `${content.substring(0, colonIndex)}?${content.substring(colonIndex)}`;
            currentPosition += 1; // Adjust position after adding ?
            typeEnd += 1;
          }
        } else {
          // Remove existing ? if optional is not selected
          const beforeColonChar = content.charAt(colonIndex - 1);
          if (beforeColonChar === '?') {
            newContent =
              content.substring(0, colonIndex - 1) +
              content.substring(colonIndex);
            currentPosition -= 1; // Adjust position after removing ?
            typeEnd -= 1;
          }
        }

        // Replace everything after the colon (remove the : from type since colon already exists)
        const typeWithoutColon = type.startsWith(':')
          ? type.substring(1)
          : type;
        newContent =
          newContent.substring(0, currentPosition) +
          typeWithoutColon +
          newContent.substring(typeEnd);
        newCursorPosition = currentPosition + typeWithoutColon.length;
      } else {
        // No colon at cursor, insert the full type with optional handling
        let insertText = type;

        if (isOptional) {
          // Insert ?:type format
          insertText = insertText.replace(':', '?:');
        }

        newContent =
          content.substring(0, position) +
          insertText +
          content.substring(position);
        newCursorPosition = position + insertText.length;
      }

      setContent(newContent);
      setTypeDropdownVisible(false);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPosition;
          textareaRef.current.selectionEnd = newCursorPosition;
          textareaRef.current.focus();
        }
      }, 0);
    },
    [content]
  );

  // Replace references in input values with actual values from previous cells
  const resolveReferences = useCallback(
    (inputData: Record<string, any>) => {
      const resolved = { ...inputData };

      Object.keys(resolved).forEach((key) => {
        const value = resolved[key];
        if (typeof value === 'string' && value.startsWith('@')) {
          // Parse reference format: @cellId.fieldName
          const match = value.match(/^@([^.]+)\.(.+)$/);
          if (match) {
            const [, refCellId, refFieldName] = match;
            const referencedOutput = availableOutputs.find(
              (output) =>
                output.cellId === refCellId && output.fieldName === refFieldName
            );
            if (referencedOutput) {
              resolved[key] = referencedOutput.value;
            }
          }
        }
      });

      return resolved;
    },
    [availableOutputs]
  );

  // Create debug logger using Ax built-in logger functions
  const createDebugLogger = async (logsArray: string[]) => {
    // Import the Ax logger functions
    const { axCreateDefaultTextLogger } = await import('@ax-llm/ax');

    // Create a function to capture log messages to the local array
    const logCapture = (message: string) => {
      console.log(message); // Also log to console for immediate feedback
      logsArray.push(message);
    };

    // Create the Ax logger with our capture function
    const logger = axCreateDefaultTextLogger(logCapture);

    return logger;
  };

  const executeSignature = useCallback(async () => {
    if (!loadedAI || modelStatus !== 'ready' || !axSignature) {
      console.log('Cannot execute: AI not ready or signature invalid');
      return;
    }

    setIsExecuting(true);
    setExecutionError(null);
    setExecutionResult(null);
    setDebugLogs([]);

    try {
      // Create a local array to capture debug logs
      const debugLogsArray: string[] = [];

      // Create debug logger using Ax built-in logger
      const logger = await createDebugLogger(debugLogsArray);

      // Import AxGen exactly like the working example
      const { AxGen } = await import('@ax-llm/ax');

      // Create AxGen directly from the text signature
      const signature = new AxGen(content);

      // Prepare input data from the input fields with reference resolution
      const inputData: Record<string, any> = {};
      Object.keys(inputValues).forEach((key) => {
        inputData[key] = inputValues[key];
      });

      // Resolve references to actual values
      const resolvedInputData = resolveReferences(inputData);

      // Execute the signature with debug logger passed in options
      const result = await signature.forward(loadedAI, resolvedInputData, {
        debug: true,
        logger: logger,
      });

      // Update debug logs with captured messages
      setDebugLogs(debugLogsArray);
      setExecutionResult(result);

      // Save outputs to global state
      if (onUpdateCellState && result) {
        onUpdateCellState(cellId, result);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      setExecutionError(errorMessage);
    } finally {
      setIsExecuting(false);
    }
  }, [
    content,
    inputValues,
    loadedAI,
    modelStatus,
    axSignature,
    availableOutputs,
    resolveReferences,
    onUpdateCellState,
    cellId,
    createDebugLogger,
  ]);

  const renderStatusIndicator = () => {
    if (!axSignature && !signatureError) {
      return (
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">Enter signature</span>
        </div>
      );
    }

    if (signatureError) {
      return (
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <XCircle className="h-4 w-4" />
          <span className="text-sm">Invalid</span>
        </div>
      );
    }

    if (axSignature) {
      try {
        const inputFields = axSignature.getInputFields();
        const outputFields = axSignature.getOutputFields();

        return (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle className="h-4 w-4" />
            <span className="text-sm">Valid</span>
            <Badge variant="secondary" className="text-xs">
              {inputFields.length}→{outputFields.length}
            </Badge>
          </div>
        );
      } catch (_error) {
        return (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <XCircle className="h-4 w-4" />
            <span className="text-sm">Invalid</span>
          </div>
        );
      }
    }

    return null;
  };

  return (
    <div className="border rounded-lg bg-card mb-4">
      {/* Cell Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 border-b bg-muted/30 gap-2 sm:gap-0">
        <div className="flex items-center gap-3 flex-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border"
          >
            Cell [{cellId.slice(-4)}]
          </button>
          {renderStatusIndicator()}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            onClick={executeSignature}
            disabled={isExecuting || !axSignature || modelStatus !== 'ready'}
            size="sm"
            variant="outline"
            className="h-10 md:h-8"
          >
            {isExecuting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                Run
                <Play className="ml-2 h-3 w-3" />
              </>
            )}
          </Button>
          {onAddCell && (
            <Button
              onClick={() => onAddCell(cellId)}
              size="sm"
              variant="ghost"
              className="h-10 md:h-8"
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
          {onDelete && (
            <Button
              onClick={() => onDelete(cellId)}
              size="sm"
              variant="ghost"
              className="h-10 md:h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Cell Content */}
      {isExpanded && (
        <div className="p-3 md:p-4 space-y-3 md:space-y-4">
          {/* Prompt Editor */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onBlur={hideTypeDropdownDelayed}
              className="w-full resize-none border rounded-md bg-background p-2 md:p-3 font-mono text-sm outline-none min-h-[100px] md:min-h-[120px] focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your signature here..."
              spellCheck={false}
            />
          </div>

          {/* Type dropdown */}
          <TypeDropdown
            visible={typeDropdownVisible}
            position={typeDropdownPosition}
            onSelect={handleTypeSelect}
            onClose={hideTypeDropdown}
            isInputField={(() => {
              const beforeCursor = content.substring(0, cursorPosition);
              return (
                !beforeCursor.includes('->') ||
                beforeCursor.lastIndexOf('->') < beforeCursor.lastIndexOf(',')
              );
            })()}
          />

          {/* Input Fields */}
          {axSignature &&
            (() => {
              try {
                const inputFields = axSignature.getInputFields();
                return (
                  inputFields.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Input Values</h4>
                      <div className="grid grid-cols-1 gap-3">
                        {inputFields.map((field: any) => (
                          <div key={field.name} className="space-y-1">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <label
                                className="text-xs font-medium"
                                htmlFor={`${cellId}-${field.name}`}
                              >
                                {field.name}
                                {field.optional && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    (optional)
                                  </span>
                                )}
                                <span className="text-muted-foreground ml-2">
                                  {field.type?.name || 'string'}
                                  {field.isArray && '[]'}
                                </span>
                              </label>
                              <div className="flex-shrink-0">
                                <CellOutputSelector
                                  availableOutputs={availableOutputs}
                                  onSelect={(reference, _actualValue) => {
                                    // Use reference so it updates when cell above changes
                                    setInputValues((prev) => ({
                                      ...prev,
                                      [field.name]: reference,
                                    }));
                                  }}
                                  disabled={false}
                                />
                              </div>
                            </div>
                            {field.type === 'string' &&
                            field.name.toLowerCase().includes('text') ? (
                              <Textarea
                                id={`${cellId}-${field.name}`}
                                placeholder={
                                  field.description || `Enter ${field.name}`
                                }
                                value={inputValues[field.name] || ''}
                                onChange={(e) =>
                                  setInputValues((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                className="min-h-[60px] md:min-h-[80px] text-sm"
                              />
                            ) : (
                              <Input
                                id={`${cellId}-${field.name}`}
                                type={
                                  field.type === 'number' ? 'number' : 'text'
                                }
                                placeholder={
                                  field.description || `Enter ${field.name}`
                                }
                                value={inputValues[field.name] || ''}
                                onChange={(e) =>
                                  setInputValues((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                className="text-sm"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                );
              } catch (_error) {
                return null;
              }
            })()}

          {/* Output Results */}
          {(executionResult || executionError) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">
                  {executionError ? 'Execution Error' : 'Results'}
                </h4>
                {(executionResult || executionError) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDebugLogs(!showDebugLogs)}
                    className="h-8 md:h-6 px-2 text-xs"
                  >
                    {showDebugLogs ? (
                      <>
                        <EyeOff className="h-3 w-3 mr-1" />
                        Hide Debug Logs
                      </>
                    ) : (
                      <>
                        <Eye className="h-3 w-3 mr-1" />
                        Show Debug Logs ({debugLogs.length})
                      </>
                    )}
                  </Button>
                )}
              </div>
              {executionError ? (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
                  <p className="text-destructive text-sm">{executionError}</p>
                </div>
              ) : axSignature ? (
                (() => {
                  try {
                    const outputFields = axSignature.getOutputFields();
                    return (
                      <div className="space-y-2">
                        {outputFields.map((field: any) => (
                          <div key={field.name} className="space-y-1">
                            <div className="text-xs font-medium flex items-center gap-2">
                              {field.name}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 md:h-6 px-2"
                                onClick={() => {
                                  const value = executionResult?.[field.name];
                                  if (value) {
                                    navigator.clipboard.writeText(
                                      typeof value === 'object'
                                        ? JSON.stringify(value, null, 2)
                                        : String(value)
                                    );
                                  }
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="rounded-md border bg-muted/30 p-3 text-sm font-mono">
                              {typeof executionResult?.[field.name] === 'object'
                                ? JSON.stringify(
                                    executionResult[field.name],
                                    null,
                                    2
                                  )
                                : String(
                                    executionResult?.[field.name] || 'No result'
                                  )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  } catch (_error) {
                    return (
                      <div className="rounded-md border bg-muted/30 p-3 text-sm font-mono">
                        {JSON.stringify(executionResult, null, 2)}
                      </div>
                    );
                  }
                })()
              ) : null}

              {/* Debug Logs Section */}
              {showDebugLogs && (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-medium text-muted-foreground">
                      Debug Logs ({debugLogs.length} entries)
                    </h5>
                    {debugLogs.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 md:h-6 px-2"
                        onClick={() => {
                          navigator.clipboard.writeText(debugLogs.join('\n'));
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={
                      debugLogs.length > 0
                        ? debugLogs.join('\n')
                        : 'No debug logs captured yet. The logger may not be receiving data from the Ax framework.'
                    }
                    readOnly
                    className="min-h-[100px] md:min-h-[120px] text-xs font-mono bg-muted/50 resize-none"
                    placeholder="Debug logs will appear here..."
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
