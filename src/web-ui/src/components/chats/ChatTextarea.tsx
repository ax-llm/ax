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
  maxTextSizeBeforeFile?: number;
  onEnterKeyPressed?: () => void;
  onFileCreated?: (file: File) => void;
}

export const ChatTextarea: React.FC<ChatTextareaProps> = ({
  className = '',
  initialRows = 1,
  maxTextSizeBeforeFile = 1000, // Default to 1000 characters
  onChange,
  onEnterKeyPressed,
  onFileCreated,
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

    // Check if the text exceeds the maxTextSizeBeforeFile
    if (e.target.value.length > maxTextSizeBeforeFile && onFileCreated) {
      const blob = new Blob([e.target.value], { type: 'text/plain' });
      const file = new File([blob], 'large_text.txt', { type: 'text/plain' });
      onFileCreated(file);
    }

    // Call the original onChange if provided
    onChange?.(e);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onEnterKeyPressed?.();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText.length > maxTextSizeBeforeFile && onFileCreated) {
      e.preventDefault();
      const blob = new Blob([pastedText], { type: 'text/plain' });
      const file = new File([blob], 'pasted_text.txt', { type: 'text/plain' });
      onFileCreated(file);
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
      onPaste={handlePaste}
      placeholder={placeholder}
      ref={textareaRef}
      rows={rows}
      value={value}
      {...props}
    />
  );
};

export default ChatTextarea;
