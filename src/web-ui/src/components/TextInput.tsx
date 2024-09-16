import { Textarea } from '@/components/ui/textarea';
import React, {
  ChangeEvent,
  KeyboardEvent,
  TextareaHTMLAttributes,
  useEffect,
  useRef,
  useState
} from 'react';

interface ChatTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  initialRows?: number;
  onEnterKeyPressed?: () => void;
}

export const TextInput: React.FC<ChatTextareaProps> = ({
  className = '',
  initialRows = 2,
  onChange,
  onEnterKeyPressed,
  placeholder = 'Type your message here...',
  value,
  ...props
}) => {
  const [rows, setRows] = useState(initialRows);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const calculateRows = (_text: string) => {
    const textareaLineHeight = 24; // Adjust this value based on your font size
    const textarea = textareaRef.current;
    if (!textarea) return initialRows;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;

    const currentRows = Math.floor(textarea.scrollHeight / textareaLineHeight);
    return currentRows < initialRows ? initialRows : currentRows;
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newRows = calculateRows(e.target.value);
    setRows(newRows);

    // Call the original onChange if provided
    onChange?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onEnterKeyPressed?.();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      const newRows = calculateRows(textareaRef.current.value);
      setRows(newRows);
    }
  }, [value]);

  return (
    <Textarea
      className={`resize-none transition-all duration-200 ${className}`}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      ref={textareaRef}
      rows={rows}
      value={value}
      {...props}
    />
  );
};
