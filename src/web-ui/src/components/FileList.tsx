import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { File, Image, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';

import { FileType, UploadedFile } from './chats/useFiles.js';

interface FileListProps {
  files: UploadedFile[];
  onRemove?: (index: number) => void;
}

const FileIcon: React.FC<{ type: FileType }> = ({ type }) => {
  return type === 'image' ? (
    <Image className="w-6 h-6" />
  ) : (
    <File className="w-6 h-6" />
  );
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(2) + ' KB';
  const mb = kb / 1024;
  return mb.toFixed(2) + ' MB';
};

const ImagePreview: React.FC<{ file: UploadedFile }> = ({ file }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <img
          alt={file.name}
          className="w-10 h-10 object-cover rounded cursor-pointer"
          src={file.url}
        />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogTitle className="text-lg font-semibold">{file.name}</DialogTitle>
        <img alt={file.name} className="w-full h-auto" src={file.url} />
      </DialogContent>
    </Dialog>
  );
};

export const FileList: React.FC<FileListProps> = ({ files, onRemove }) => {
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file, index) => (
        <Card className="bg-gray-50" key={file.id}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {file.type.startsWith('image') ? (
                <ImagePreview file={file} />
              ) : (
                <FileIcon type={file.type} />
              )}
              <div>
                <p className="font-medium text-sm text-gray-700">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {formatFileSize(file.size)}
                </p>
              </div>
            </div>
            {onRemove && (
              <Button
                className="text-gray-500 hover:text-red-500"
                onClick={() => onRemove(index)}
                size="sm"
                variant="ghost"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
