import { CloudUpload } from 'lucide-react';
import React from 'react';

import { Input } from './ui/input.js';

export const FileUpload = ({
  message,
  onChange,
  props
}: {
  message?: string;
  onChange: (files: FileList | null) => void;
  props?: any;
}) => {
  return (
    <div className="flex items-center justify-center w-full">
      <label
        className="flex flex-col items-center justify-center text-gray-400 border-2 border-gray-400 border-dashed rounded-lg cursor-pointer hover:border-gray-500 hover:text-gray-500 w-full"
        htmlFor="dropzone-file"
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <CloudUpload className="w-12 h-12" />
          <p className="mb-2 text-sm font-semibold">
            Click to upload or drag and drop (1 or more files)
          </p>
          <p className="text-sm text-center">
            Attach PDF, Word, Excel, etc files
          </p>
        </div>

        <Input
          className="hidden"
          id="dropzone-file"
          multiple={true}
          onChange={(e) => {
            onChange(e.target.files);
          }}
          type="file"
          {...props}
        />
      </label>
    </div>
  );
};
