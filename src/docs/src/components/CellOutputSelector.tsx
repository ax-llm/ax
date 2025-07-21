import { ChevronDown, Link2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';

interface AvailableOutput {
  cellId: string;
  fieldName: string;
  value: any;
  cellIndex: number;
}

interface CellOutputSelectorProps {
  availableOutputs: AvailableOutput[];
  onSelect: (reference: string, actualValue: any) => void;
  disabled?: boolean;
}

export default function CellOutputSelector({ 
  availableOutputs, 
  onSelect, 
  disabled = false 
}: CellOutputSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (output: AvailableOutput) => {
    const reference = `@${output.cellId}.${output.fieldName}`;
    onSelect(reference, output.value);
    setIsOpen(false);
  };

  const formatValue = (value: any) => {
    if (typeof value === 'string') {
      return value.length > 30 ? value.slice(0, 30) + '...' : value;
    }
    if (typeof value === 'object') {
      return JSON.stringify(value).length > 30 
        ? JSON.stringify(value).slice(0, 30) + '...'
        : JSON.stringify(value);
    }
    return String(value);
  };

  if (availableOutputs.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No outputs from previous cells
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="h-8 text-xs"
      >
        <Link2 className="h-3 w-3 mr-1" />
        Link to output
        <ChevronDown className="h-3 w-3 ml-1" />
      </Button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-80 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-y-auto">
          <div className="p-2">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Select output from previous cells:
            </div>
            {availableOutputs.map((output, index) => (
              <button
                key={`${output.cellId}-${output.fieldName}`}
                onClick={() => handleSelect(output)}
                className="w-full text-left p-2 rounded hover:bg-accent text-xs transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-blue-600 dark:text-blue-400">
                    Cell [{output.cellId.slice(-4)}]
                  </span>
                  <span className="font-medium">{output.fieldName}</span>
                </div>
                <div className="text-muted-foreground truncate">
                  {formatValue(output.value)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Reference: @{output.cellId}.{output.fieldName}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}