import { ObjectId } from 'mongodb';

export const objectIds = (ids?: string): ObjectId[] => {
  if (!ids) {
    return [];
  }
  return ids.split(',').map((id) => new ObjectId(id.trim()));
};

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
  // '.jpg', '.jpeg', '.png', '.gif',

  // Markdown
  '.md',

  // XML
  '.xml'
];

export const getFiles = (form: FormData): File[] => {
  return Array.from(form.entries())
    .filter(([, value]) => typeof value === 'object')
    .map(([, value]) => value as File)
    .filter((file) => {
      if (!allowedFileTypesList || allowedFileTypesList.length === 0) {
        return true; // If no file types are specified, allow all files
      }

      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      return allowedFileTypesList.includes(fileExtension);
    });
};
