import { FileType, UploadedFile } from '@/components/FileList.js';
import { Textarea } from '@/components/ui/textarea';
import React, {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  TextareaHTMLAttributes,
  useEffect,
  useRef,
  useState
} from 'react';

// Assuming FileType is an enum or type defined elsewhere
// If not, you might want to define it here, e.g.:
// type FileType = 'image' | 'document' | 'other';

interface ChatTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  children: React.ReactNode;
  initialRows?: number;
  maxTextSizeBeforeFile?: number;
  onEnterKeyPressed?: () => void;
  onFileAdded?: (file: UploadedFile) => void;
}

export const ChatTextarea: React.FC<ChatTextareaProps> = ({
  children,
  className = '',
  initialRows = 1,
  maxTextSizeBeforeFile = 1000,
  onChange,
  onEnterKeyPressed,
  onFileAdded,
  placeholder = 'Type your message here or drop a file...',
  value,
  ...props
}) => {
  const [rows, setRows] = useState(initialRows);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);

  const calculateRows = (_text: string) => {
    const textareaLineHeight = 24;
    const textarea = textareaRef.current;
    if (!textarea) return initialRows;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;

    const currentRows = Math.floor(textarea.scrollHeight / textareaLineHeight);
    return currentRows < initialRows ? initialRows : currentRows;
  };

  const createUploadedFile = (file: File): UploadedFile => {
    const fileType = getFileType(file.type);
    if (!fileType) {
      throw new Error(`Unsupported file type: ${file.type}`);
    }
    return {
      id: Math.random().toString(36).substr(2, 9), // Generate a random ID
      name: file.name,
      size: file.size,
      type: fileType,
      url: URL.createObjectURL(file) // Create a temporary URL for the file
    };
  };

  const getFileType = (mimeType: string): FileType | null => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('application/')) return 'document';
    return null;
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newRows = calculateRows(e.target.value);
    setRows(newRows);

    if (e.target.value.length > maxTextSizeBeforeFile && onFileAdded) {
      const blob = new Blob([e.target.value], { type: 'text/plain' });
      const file = new File([blob], 'large_text.txt', { type: 'text/plain' });
      try {
        const uploadedFile = createUploadedFile(file);
        onFileAdded(uploadedFile);
      } catch (error) {
        console.error(error);
      }
    }

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
    if (pastedText.length > maxTextSizeBeforeFile && onFileAdded) {
      e.preventDefault();
      const blob = new Blob([pastedText], { type: 'text/plain' });
      const file = new File([blob], 'pasted_text.txt', { type: 'text/plain' });
      const uploadedFile = createUploadedFile(file);
      onFileAdded(uploadedFile);
    }
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files.length > 0 && onFileAdded) {
      const uploadedFile = createUploadedFile(files[0]);
      onFileAdded(uploadedFile);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      const newRows = calculateRows(textareaRef.current.value);
      setRows(newRows);
    }
  }, [value]);

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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

      {children}

      {isDraggingOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-100 bg-opacity-70 border-2 border-dashed border-blue-300 rounded z-10">
          <p className="text-blue-600 font-semibold">Drop file here</p>
        </div>
      )}
    </div>
  );
};
