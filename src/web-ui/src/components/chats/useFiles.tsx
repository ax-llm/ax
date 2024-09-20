import { useCallback, useEffect, useRef, useState } from 'react';

export type FileType = 'document' | 'image';

export interface UploadedFile {
  name: string;
  size: number;
  type: FileType;
  url: string;
}

export const useFiles = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const filesRef = useRef<UploadedFile[]>([]);

  // Update ref whenever files change
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const addFile = (uploadedFiles: UploadedFile | UploadedFile[]) => {
    setFiles((prevFiles) => [
      ...prevFiles,
      ...(Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles])
    ]);
  };

  const removeFile = (index: number) => {
    setFiles((prevFiles) => {
      const newFiles = [...prevFiles];
      URL.revokeObjectURL(newFiles[index].url);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const clearFiles = () => {
    files.forEach((file) => URL.revokeObjectURL(file.url));
    setFiles([]);
  };

  const getFilesAsFormData = useCallback(
    async (additionalData?: Record<string, any>) => {
      const formData = new FormData();

      if (additionalData) {
        formData.append('json', JSON.stringify(additionalData));
      }

      for (const file of filesRef.current) {
        const response = await fetch(file.url);
        const blob = await response.blob();
        formData.append('files', blob, file.name);
      }

      return formData;
    },
    []
  );

  useEffect(() => {
    return () => {
      filesRef.current.forEach((file) => URL.revokeObjectURL(file.url));
    };
  }, []);

  return {
    addFile,
    clearFiles,
    files,
    getFilesAsFormData,
    removeFile
  };
};
