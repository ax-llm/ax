import { CloudUpload } from 'lucide-react';

import { Input } from './ui/input.js';

export const allowedFileTypesList = [
  // PDF
  '.pdf',

  // Microsoft Office
  '.doc',
  '.docx', // Word
  '.xls',
  '.xlsx', // Excel
  '.ppt',
  '.pptx', // PowerPoint

  // OpenDocument formats
  '.odt', // OpenDocument Text
  '.ods', // OpenDocument Spreadsheet
  '.odp', // OpenDocument Presentation

  // Plain text
  '.txt',

  // Rich Text Format
  '.rtf',

  // Comma-Separated Values
  '.csv',

  // Images (if you want to allow them)
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',

  // Markdown
  '.md',

  // XML
  '.xml'
];

export const FileUpload = ({
  allowedFileTypes = allowedFileTypesList,
  message,
  onChange,
  ...props
}: {
  [key: string]: any;
  allowedFileTypes?: string[];
  message?: string;
  onChange: (files: FileList | null) => void;
}) => {
  const fileTypesText = allowedFileTypes
    ? allowedFileTypes.join(', ').toUpperCase()
    : 'PDF, Word, Excel, etc';

  return (
    <div className="flex items-center justify-center w-full">
      <label
        className="flex flex-col items-center justify-center w-full text-gray-400 border-2 border-gray-400 border-dashed rounded-lg cursor-pointer hover:border-gray-500 hover:text-gray-500"
        htmlFor="dropzone-file"
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <CloudUpload className="w-12 h-12" />
          <p className="mb-2 text-sm font-semibold">
            {message || 'Click to upload or drag and drop (1 or more files)'}
          </p>
          <p className="text-sm text-center">Attach {fileTypesText} files</p>
        </div>

        <Input
          accept={allowedFileTypes ? allowedFileTypes.join(',') : undefined}
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
