import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import React, { useRef } from 'react';

import { allowedFileTypesList } from './FileUpload.js';
import { UploadedFile } from './chats/useFiles.js';

interface FileUploadButtonProps {
  allowedFileTypes?: string[];
  multiple?: boolean;
  onFilesAdded: (files: UploadedFile[]) => void;
}

export const FileUploadButton: React.FC<FileUploadButtonProps> = ({
  allowedFileTypes = allowedFileTypesList,
  multiple = true,
  onFilesAdded
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (files.length > 0) {
      const uploadedFiles: UploadedFile[] = files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type.startsWith('image/') ? 'image' : 'document',
        url: URL.createObjectURL(file)
      }));

      onFilesAdded(uploadedFiles);
    }

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <Button onClick={handleClick} size="icon" variant="ghost">
        <Upload size={20} />
      </Button>
      <input
        accept={allowedFileTypes ? allowedFileTypes.join(',') : undefined}
        className="hidden"
        multiple={multiple}
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
    </>
  );
};
