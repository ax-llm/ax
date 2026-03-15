import { ax, axCreateDefaultTextLogger, s } from '@ax-llm/ax';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
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

  // Parse signature whenever content changes
  useEffect(() => {
    try {
      if (!content.trim()) {
        setAxSignature(null);
        setSignatureError(null);
        onUpdateCellSignature?.(cellId, null);
        return;
      }

      const signature = s(content);
      setAxSignature(signature);
      setSignatureError(null);
      onUpdateCellSignature?.(cellId, signature);
    } catch (error) {
      setAxSignature(null);
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as any).message)
          : 'Invalid signature';
      const suggestion =
        error && typeof error === 'object' && 'suggestion' in error
          ? String((error as any).suggestion)
          : '';
      setSignatureError(suggestion ? `${message}\n${suggestion}` : message);
      onUpdateCellSignature?.(cellId, null);
    }
  }, [content, cellId, onUpdateCellSignature]);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      setCursorPosition(e.target.selectionStart);
    },
    []
  );

  const showTypeDropdownFn = useCallback(() => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const rect = textarea.getBoundingClientRect();
    const position = textarea.selectionStart;

    const lines = content.substring(0, position).split('\n');
    const currentLine = lines.length - 1;
    const currentColumn = lines[lines.length - 1].length;

    const lineHeight = 24;
    const charWidth = 8.4;

    const x = rect.left + currentColumn * charWidth + 16;
    const y = rect.top + currentLine * lineHeight + lineHeight + 16;

    setTypeDropdownVisible(true);
    setTypeDropdownPosition({ x, y });
  }, [content]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        setTypeDropdownVisible(false);
        return;
      }
      if (e.key === ':') {
        requestAnimationFrame(() => {
          showTypeDropdownFn();
        });
      }
    },
    [showTypeDropdownFn]
  );

  const hideTypeDropdown = useCallback(() => {
    setTypeDropdownVisible(false);
  }, []);

  const hideTypeDropdownDelayed = useCallback(() => {
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

      let newContent = content;
      let newCursorPosition = position;

      const colonIndex = beforeCursor.lastIndexOf(':');

      if (colonIndex !== -1 && colonIndex === position - 1) {
        let currentPosition = position;
        const afterColon = content.substring(currentPosition);
        const typeEndMatch = afterColon.match(/[,\->"]/);
        let typeEnd = typeEndMatch
          ? currentPosition + (typeEndMatch.index ?? 0)
          : content.length;

        if (isOptional) {
          const beforeColonChar = content.charAt(colonIndex - 1);
          if (beforeColonChar !== '?') {
            newContent = `${content.substring(0, colonIndex)}?${content.substring(colonIndex)}`;
            currentPosition += 1;
            typeEnd += 1;
          }
        } else {
          const beforeColonChar = content.charAt(colonIndex - 1);
          if (beforeColonChar === '?') {
            newContent =
              content.substring(0, colonIndex - 1) +
              content.substring(colonIndex);
            currentPosition -= 1;
            typeEnd -= 1;
          }
        }

        const typeWithoutColon = type.startsWith(':')
          ? type.substring(1)
          : type;
        newContent =
          newContent.substring(0, currentPosition) +
          typeWithoutColon +
          newContent.substring(typeEnd);
        newCursorPosition = currentPosition + typeWithoutColon.length;
      } else {
        let insertText = type;
        if (isOptional) {
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

  const resolveReferences = useCallback(
    (inputData: Record<string, any>) => {
      const resolved = { ...inputData };
      Object.keys(resolved).forEach((key) => {
        const value = resolved[key];
        if (typeof value === 'string' && value.startsWith('@')) {
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

  const createDebugLogger = async (logsArray: string[]) => {
    const logCapture = (message: string) => {
      logsArray.push(message);
    };
    return axCreateDefaultTextLogger(logCapture);
  };

  const executeSignature = useCallback(async () => {
    if (!loadedAI || modelStatus !== 'ready' || !axSignature) return;

    setIsExecuting(true);
    setExecutionError(null);
    setExecutionResult(null);
    setDebugLogs([]);

    try {
      const debugLogsArray: string[] = [];
      const logger = await createDebugLogger(debugLogsArray);
      const generator = ax(content);

      const inputData: Record<string, any> = {};
      Object.keys(inputValues).forEach((key) => {
        inputData[key] = inputValues[key];
      });

      const resolvedInputData = resolveReferences(inputData);
      const result = await generator.forward(loadedAI, resolvedInputData, {
        debug: true,
        logger,
      });

      setDebugLogs(debugLogsArray);
      setExecutionResult(result);

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

  const renderStatusBadge = () => {
    if (!axSignature && !signatureError) {
      return (
        <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500">
          <AlertCircle className="h-3.5 w-3.5" />
          <span className="text-xs">Enter signature</span>
        </div>
      );
    }

    if (signatureError) {
      return (
        <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400">
          <XCircle className="h-3.5 w-3.5" />
          <span className="text-xs">Invalid</span>
        </div>
      );
    }

    if (axSignature) {
      try {
        const inputFields = axSignature.getInputFields();
        const outputFields = axSignature.getOutputFields();
        return (
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="h-3.5 w-3.5" />
            <span className="text-xs">Valid</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
              {inputFields.length}&rarr;{outputFields.length}
            </span>
          </div>
        );
      } catch (_error) {
        return (
          <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400">
            <XCircle className="h-3.5 w-3.5" />
            <span className="text-xs">Invalid</span>
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/20 overflow-hidden mb-5 shadow-sm dark:bg-white/[0.02]">
      {/* Cell Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-white/[0.06] border-b border-gray-200 dark:border-white/20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-mono"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            [{cellId.slice(-4)}]
          </button>
          {renderStatusBadge()}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            onClick={executeSignature}
            disabled={isExecuting || !axSignature || modelStatus !== 'ready'}
            size="sm"
            className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0"
          >
            {isExecuting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Play className="h-3 w-3 mr-1.5" />
                Run
              </>
            )}
          </Button>
          {onAddCell && (
            <Button
              onClick={() => onAddCell(cellId)}
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              onClick={() => onDelete(cellId)}
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Cell Content */}
      {isExpanded && (
        <div className="space-y-0">
          {/* Signature Editor — dark code block */}
          <div className="relative">
            <div className="bg-[#1a1b26]">
              {/* Terminal dots header */}
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-white/5">
                <div className="w-2 h-2 rounded-full bg-red-400/70" />
                <div className="w-2 h-2 rounded-full bg-amber-400/70" />
                <div className="w-2 h-2 rounded-full bg-green-400/70" />
                <span className="ml-2 text-[11px] text-gray-500 font-mono">
                  signature
                </span>
              </div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                onBlur={hideTypeDropdownDelayed}
                className="w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-gray-300 outline-none min-h-[80px] placeholder:text-gray-600 caret-emerald-400"
                placeholder="name:type -> output:type"
                spellCheck={false}
              />
            </div>

            {/* Signature error */}
            {signatureError && (
              <div className="px-4 py-2 bg-red-50 dark:bg-red-500/10 border-t border-red-200 dark:border-red-500/20">
                <p className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap">
                  {signatureError}
                </p>
              </div>
            )}
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
                    <div className="p-4 border-t border-gray-200 dark:border-white/20 space-y-3">
                      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Inputs
                      </h4>
                      <div className="grid grid-cols-1 gap-3">
                        {inputFields.map((field: any) => (
                          <div key={field.name} className="space-y-1.5">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <label
                                className="text-xs font-medium text-gray-700 dark:text-gray-300"
                                htmlFor={`${cellId}-${field.name}`}
                              >
                                {field.name}
                                {field.optional && (
                                  <span className="text-gray-400 dark:text-gray-500 ml-1">
                                    (optional)
                                  </span>
                                )}
                                <span className="text-gray-400 dark:text-gray-500 ml-1.5 font-mono text-[11px]">
                                  {field.type?.name || 'string'}
                                  {field.isArray && '[]'}
                                </span>
                              </label>
                              <div className="flex-shrink-0">
                                <CellOutputSelector
                                  availableOutputs={availableOutputs}
                                  onSelect={(reference, _actualValue) => {
                                    setInputValues((prev) => ({
                                      ...prev,
                                      [field.name]: reference,
                                    }));
                                  }}
                                  disabled={false}
                                />
                              </div>
                            </div>
                            {field.type?.name === 'string' &&
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
                                className="min-h-[60px] text-sm border-gray-200 dark:border-white/20 bg-white dark:bg-white/[0.07]"
                              />
                            ) : (
                              <Input
                                id={`${cellId}-${field.name}`}
                                type={
                                  field.type?.name === 'number'
                                    ? 'number'
                                    : 'text'
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
                                className="text-sm border-gray-200 dark:border-white/20 bg-white dark:bg-white/[0.07]"
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
            <div className="p-4 border-t border-gray-200 dark:border-white/20 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  {executionError ? 'Error' : 'Output'}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDebugLogs(!showDebugLogs)}
                  className="h-6 px-2 text-[11px] text-gray-400 dark:text-gray-500"
                >
                  {showDebugLogs ? (
                    <>
                      <EyeOff className="h-3 w-3 mr-1" />
                      Hide Logs
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3 mr-1" />
                      Logs ({debugLogs.length})
                    </>
                  )}
                </Button>
              </div>

              {executionError ? (
                <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3">
                  <p className="text-red-600 dark:text-red-400 text-sm">
                    {executionError}
                  </p>
                </div>
              ) : axSignature ? (
                (() => {
                  try {
                    const outputFields = axSignature.getOutputFields();
                    return (
                      <div className="space-y-2">
                        {outputFields.map((field: any) => (
                          <div key={field.name} className="space-y-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium text-gray-700 dark:text-gray-300">
                                {field.name}
                              </span>
                              <button
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
                              </button>
                            </div>
                            <div className="rounded-lg bg-gray-50 dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 p-3 text-sm font-mono text-gray-700 dark:text-gray-300">
                              {typeof executionResult?.[field.name] === 'object'
                                ? JSON.stringify(
                                    executionResult[field.name],
                                    null,
                                    2
                                  )
                                : String(
                                    executionResult?.[field.name] ?? 'No result'
                                  )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  } catch (_error) {
                    return (
                      <div className="rounded-lg bg-gray-50 dark:bg-white/[0.07] border border-gray-200 dark:border-white/20 p-3 text-sm font-mono text-gray-700 dark:text-gray-300">
                        {JSON.stringify(executionResult, null, 2)}
                      </div>
                    );
                  }
                })()
              ) : null}

              {/* Debug Logs */}
              {showDebugLogs && (
                <div className="space-y-2 border-t border-gray-200 dark:border-white/20 pt-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                      Debug Logs ({debugLogs.length})
                    </h5>
                    {debugLogs.length > 0 && (
                      <button
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        onClick={() => {
                          navigator.clipboard.writeText(debugLogs.join('\n'));
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="rounded-lg bg-[#1a1b26] p-3 max-h-48 overflow-y-auto">
                    <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap">
                      {debugLogs.length > 0
                        ? debugLogs.join('\n')
                        : 'No debug logs captured.'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
