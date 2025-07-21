import {
  AlertCircle,
  CheckCircle,
  Copy,
  Loader2,
  Play,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import TypeDropdown from './TypeDropdown';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface NotebookCellProps {
  cellId: string;
  initialContent?: string;
  loadedAI?: any;
  modelStatus: 'idle' | 'loading' | 'ready' | 'error';
  isDarkMode: boolean;
  onDelete?: (cellId: string) => void;
  onAddCell?: (afterCellId: string) => void;
}

export default function NotebookCell({
  cellId,
  initialContent = 'userQuestion:string "User input question" -> assistantResponse:string "AI assistant response"',
  loadedAI,
  modelStatus,
  isDarkMode,
  onDelete,
  onAddCell,
}: NotebookCellProps) {
  const [content, setContent] = useState(initialContent);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [axSignature, setAxSignature] = useState<any>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [typeDropdownVisible, setTypeDropdownVisible] = useState(false);
  const [typeDropdownPosition, setTypeDropdownPosition] = useState({ x: 0, y: 0 });

  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Parse signature with AxSignature whenever content changes
  useEffect(() => {
    const parseSignature = async () => {
      try {
        if (!content.trim()) {
          setAxSignature(null);
          setSignatureError(null);
          return;
        }

        const { AxSignature } = await import('@ax-llm/ax');
        const signature = new AxSignature(content);
        setAxSignature(signature);
        setSignatureError(null);
      } catch (error) {
        console.error('Signature parsing error:', error);
        setAxSignature(null);
        setSignatureError(error instanceof Error ? error.message : 'Invalid signature');
      }
    };

    parseSignature();
  }, [content]);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setContent(newContent);
      setCursorPosition(e.target.selectionStart);
    },
    []
  );

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
        setTimeout(() => {
          showTypeDropdown();
        }, 0);
      }
    },
    []
  );


  const showTypeDropdown = useCallback(() => {
    if (!textareaRef.current) return;

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

    setTypeDropdownVisible(true);
    setTypeDropdownPosition({ x, y });
  }, [content]);

  const hideTypeDropdown = useCallback(() => {
    setTypeDropdownVisible(false);
  }, []);

  const handleTypeSelect = useCallback(
    (type: string, isOptional: boolean, isArray: boolean) => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const position = textarea.selectionStart;

      // Find the field name before the ":"
      const beforeColon = content.substring(0, position);
      const colonIndex = beforeColon.lastIndexOf(':');
      
      let newContent = content;
      let insertPosition = position;
      
      // Add type with array notation if needed
      let typeText = type;
      if (isArray) {
        typeText += '[]';
      }
      
      // If optional is selected, add ? before the colon
      if (isOptional && colonIndex !== -1) {
        // Find the start of the field name
        const beforeField = beforeColon.substring(0, colonIndex);
        const fieldStart = Math.max(
          beforeField.lastIndexOf(','),
          beforeField.lastIndexOf('->'),
          beforeField.lastIndexOf('"')
        ) + 1;
        
        const fieldName = beforeColon.substring(fieldStart, colonIndex).trim();
        if (fieldName && !fieldName.endsWith('?')) {
          // Insert ? before the colon
          newContent = content.substring(0, colonIndex) + '?' + content.substring(colonIndex);
          insertPosition = position + 1; // Account for the added ?
        }
      }
      
      // Insert the type
      newContent = newContent.substring(0, insertPosition) + typeText + newContent.substring(insertPosition);
      const newCursorPosition = insertPosition + typeText.length;

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


  const executeSignature = useCallback(async () => {
    if (!loadedAI || modelStatus !== 'ready' || !axSignature) {
      console.log('Cannot execute: AI not ready or signature invalid');
      return;
    }
    
    setIsExecuting(true);
    setExecutionError(null);
    setExecutionResult(null);
    
    try {
      // Import AxGen exactly like the working example
      const { AxGen } = await import('@ax-llm/ax');
      
      console.log('Creating AxGen with signature:', content);
      
      // Create AxGen directly from the text signature, just like the working example
      const signature = new AxGen(content);
      
      console.log('AxGen created:', signature);
      
      // Prepare input data from the input fields
      const inputData: Record<string, any> = {};
      Object.keys(inputValues).forEach(key => {
        inputData[key] = inputValues[key];
      });
      
      console.log('Input data:', inputData);
      console.log('Using AI:', loadedAI);
      
      // Execute the signature exactly like the working example
      const result = await signature.forward(loadedAI, inputData);
      console.log('Execution result:', result);
      setExecutionResult(result);
      
    } catch (error) {
      console.error('Execution error:', error);
      console.error('Full error details:', error);
      if (error.cause) {
        console.error('Error cause:', error.cause);
      }
      setExecutionError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsExecuting(false);
    }
  }, [content, inputValues, loadedAI, modelStatus, axSignature]);

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
      } catch (error) {
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
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border"
          >
            Cell [{cellId.slice(-4)}]
          </button>
          {renderStatusIndicator()}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={executeSignature}
            disabled={isExecuting || !axSignature || modelStatus !== 'ready'}
            size="sm"
            variant="outline"
            className="h-8"
          >
            {isExecuting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </Button>
          {onAddCell && (
            <Button
              onClick={() => onAddCell(cellId)}
              size="sm"
              variant="ghost"
              className="h-8"
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
          {onDelete && (
            <Button
              onClick={() => onDelete(cellId)}
              size="sm"
              variant="ghost"
              className="h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Cell Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Prompt Editor */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onBlur={hideTypeDropdown}
              className="w-full resize-none border rounded-md bg-background p-3 font-mono text-sm outline-none min-h-[120px] focus:ring-2 focus:ring-blue-500"
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
                beforeCursor.lastIndexOf('->') <
                  beforeCursor.lastIndexOf(',')
              );
            })()}
          />

          {/* Input Fields */}
          {axSignature && (() => {
            try {
              const inputFields = axSignature.getInputFields();
              return inputFields.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Input Values</h4>
                  <div className="grid gap-3">
                    {inputFields.map((field: any) => (
                      <div key={field.name} className="space-y-1">
                        <label className="text-xs font-medium" htmlFor={`${cellId}-${field.name}`}>
                          {field.name}
                          {field.optional && <span className="text-muted-foreground"> (optional)</span>}
                          <span className="text-muted-foreground ml-2">
                            {String(field.type)}{field.isArray && '[]'}
                          </span>
                        </label>
                        {field.type === 'string' && field.name.toLowerCase().includes('text') ? (
                          <Textarea
                            id={`${cellId}-${field.name}`}
                            placeholder={field.description || `Enter ${field.name}`}
                            value={inputValues[field.name] || ''}
                            onChange={(e) => 
                              setInputValues(prev => ({ ...prev, [field.name]: e.target.value }))
                            }
                            className="min-h-[60px] text-sm"
                          />
                        ) : (
                          <Input
                            id={`${cellId}-${field.name}`}
                            type={field.type === 'number' ? 'number' : 'text'}
                            placeholder={field.description || `Enter ${field.name}`}
                            value={inputValues[field.name] || ''}
                            onChange={(e) => 
                              setInputValues(prev => ({ ...prev, [field.name]: e.target.value }))
                            }
                            className="text-sm"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            } catch (error) {
              return null;
            }
          })()}

          {/* Output Results */}
          {(executionResult || executionError) && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium">
                {executionError ? 'Execution Error' : 'Results'}
              </h4>
              {executionError ? (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
                  <p className="text-destructive text-sm">{executionError}</p>
                </div>
              ) : axSignature ? (() => {
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
                              className="h-6 px-2"
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
                              ? JSON.stringify(executionResult[field.name], null, 2)
                              : String(executionResult?.[field.name] || 'No result')
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                } catch (error) {
                  return (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm font-mono">
                      {JSON.stringify(executionResult, null, 2)}
                    </div>
                  );
                }
              })() : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}