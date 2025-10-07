import { useState, useRef, useEffect } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Check } from 'lucide-react';

interface FieldTypeOption {
  value: string;
  label: string;
  detail: string;
  description: string;
  requiresOptions?: boolean;
  requiresLanguage?: boolean;
}

/**
 * Available field type options with their metadata and requirements.
 * Each type includes display information and optional constraints for options or language specification.
 */
const FIELD_TYPES: FieldTypeOption[] = [
  {
    value: 'string',
    label: 'string',
    detail: 'Text field',
    description: 'A text field for string input/output',
  },
  {
    value: 'number',
    label: 'number',
    detail: 'Numeric field',
    description: 'A numeric field for integer or decimal values',
  },
  {
    value: 'boolean',
    label: 'boolean',
    detail: 'True/false field',
    description: 'A boolean field for true/false values',
  },
  {
    value: 'date',
    label: 'date',
    detail: 'Date field',
    description: 'A date field (YYYY-MM-DD format)',
  },
  {
    value: 'datetime',
    label: 'datetime',
    detail: 'Date and time field',
    description: 'A datetime field with date and time information',
  },
  {
    value: 'image',
    label: 'image',
    detail: 'Image field (input only)',
    description: 'An image field for file uploads (input fields only)',
  },
  {
    value: 'audio',
    label: 'audio',
    detail: 'Audio field (input only)',
    description: 'An audio field for audio file uploads (input fields only)',
  },
  {
    value: 'json',
    label: 'json',
    detail: 'JSON object field',
    description: 'A JSON field for structured data objects',
  },
  {
    value: 'code',
    label: 'code',
    detail: 'Code block field',
    description: 'A code field with syntax highlighting',
    requiresLanguage: true,
  },
  {
    value: 'class',
    label: 'class',
    detail: 'Classification field (output only)',
    description:
      'A classification field with predefined options (output fields only)',
    requiresOptions: true,
  },
];

interface TypeDropdownProps {
  visible: boolean;
  position: { x: number; y: number };
  onSelect: (type: string, isOptional: boolean, isArray: boolean) => void;
  onClose: () => void;
  isInputField?: boolean;
}

/**
 * Dropdown component for selecting field types with optional modifiers.
 * Displays available field types filtered by input/output context, allows toggling optional and array modifiers,
 * handles click-outside and keyboard events for closing, and formats the selected type with appropriate syntax.
 */
export default function TypeDropdown({
  visible,
  position,
  onSelect,
  onClose,
  isInputField = false,
}: TypeDropdownProps) {
  const [selectedOptional, setSelectedOptional] = useState(false);
  const [selectedArray, setSelectedArray] = useState(false);
  const [hoveredType, setHoveredType] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /**
     * Closes the dropdown when a click occurs outside the dropdown element.
     */
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    if (visible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [visible, onClose]);

  useEffect(() => {
    /**
     * Closes the dropdown when the Escape key is pressed.
     */
    function handleKeyDown(event: KeyboardEvent) {
      if (!visible) return;

      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  /**
   * Processes the selected field type and formats it with modifiers.
   * Adds special formatting for types requiring options, appends array notation if selected,
   * prefixes with colon, and resets the modifier state after selection.
   */
  const handleTypeSelect = (type: FieldTypeOption) => {
    let insertText = type.value;

    // Add special formatting for certain types
    if (type.requiresOptions) {
      insertText = `${type.value} "class1, class2, class3"`;
    }

    // Add array notation if selected
    if (selectedArray) {
      insertText += '[]';
    }

    // Prefix with colon by default
    insertText = `:${insertText}`;

    onSelect(insertText, selectedOptional, selectedArray);

    // Reset state
    setSelectedOptional(false);
    setSelectedArray(false);
    setHoveredType(null);
  };

  // Filter types based on input/output context
  const availableTypes = FIELD_TYPES.filter((type) => {
    if (isInputField) {
      // Input fields can't use 'class' type
      return type.value !== 'class';
    }
    return true;
  });

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 bg-popover border rounded-lg shadow-lg min-w-80 max-h-96 overflow-y-auto"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {/* Header with modifiers */}
      <div className="border-b p-3 bg-muted/30">
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Field Modifiers
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={selectedOptional ? 'default' : 'outline'}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setSelectedOptional(!selectedOptional);
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="text-xs h-7"
          >
            {selectedOptional && <Check className="w-3 h-3 mr-1" />}
            Optional (?)
          </Button>
          <Button
            size="sm"
            variant={selectedArray ? 'default' : 'outline'}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setSelectedArray(!selectedArray);
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="text-xs h-7"
          >
            {selectedArray && <Check className="w-3 h-3 mr-1" />}
            Array ([])
          </Button>
        </div>
      </div>

      {/* Type list */}
      <div className="p-1">
        <div className="text-xs font-medium text-muted-foreground p-2 pb-1">
          Field Types
        </div>
        {availableTypes.map((type) => (
          <button
            key={type.value}
            className="flex items-center gap-3 px-3 py-2 hover:bg-accent cursor-pointer rounded-md mx-1 w-full text-left"
            onClick={() => handleTypeSelect(type)}
            onMouseEnter={() => setHoveredType(type.value)}
            onMouseLeave={() => setHoveredType(null)}
          >
            <div className="flex-1">
              <div className="font-medium text-sm font-mono text-primary">
                {selectedOptional && '?'}:{type.label}
                {selectedArray && '[]'}
              </div>
              <div className="text-xs text-muted-foreground">{type.detail}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline" className="text-xs">
                type
              </Badge>
              {type.requiresOptions && (
                <Badge variant="secondary" className="text-xs">
                  needs options
                </Badge>
              )}
              {type.requiresLanguage && (
                <Badge variant="secondary" className="text-xs">
                  needs language
                </Badge>
              )}
              {isInputField && type.value === 'class' && (
                <Badge variant="destructive" className="text-xs">
                  output only
                </Badge>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Footer with description */}
      {hoveredType && (
        <div className="border-t p-3 bg-muted/30">
          <div className="text-xs text-muted-foreground">
            {availableTypes.find((t) => t.value === hoveredType)?.description}
          </div>
        </div>
      )}
    </div>
  );
}
