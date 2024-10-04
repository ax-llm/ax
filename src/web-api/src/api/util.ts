import type { HandlerContext } from '@/util';

import { ObjectId } from 'mongodb';
import sharp from 'sharp';

export const objectIds = (ids?: string): ObjectId[] => {
  if (!ids) {
    return [];
  }
  return ids.split(',').map((id) => new ObjectId(id.trim()));
};

export const docFileTypesList = [
  // PDF
  'pdf',

  // Microsoft Office
  'doc',
  'docx', // Word
  'xls',
  'xlsx', // Excel
  'ppt',
  'pptx', // PowerPoint

  // OpenDocument formats
  'odt', // OpenDocument Text
  'ods', // OpenDocument Spreadsheet
  'odp', // OpenDocument Presentation

  // Plain text
  'txt',

  // Rich Text Format
  'rtf',

  // Comma-Separated Values
  'csv',

  // Markdown
  'md',

  // XML
  'xml'
];

export const imageFileTypesList = ['jpg', 'jpeg', 'png', 'gif'];

export interface GetFilesResult {
  docs: File[];
  images: File[];
}

export const getFiles = async (form: FormData): Promise<GetFilesResult> => {
  const files = Array.from(form.entries())
    .filter(([, value]) => typeof value === 'object')
    .map(([, value]) => value as File)
    .map((f) => ({
      ext: f.name.split('.').pop()?.toLowerCase() ?? '',
      file: f
    }));

  const docs = files
    .filter((v) => docFileTypesList.includes(v.ext))
    .map((v) => v.file);

  const imageList = files
    .filter((v) => imageFileTypesList.includes(v.ext))
    .map((v) => v.file);

  const images = [];
  for (const image of imageList) {
    const buf = await image.arrayBuffer();
    const buffer = await sharp(buf)
      .resize(400)
      .jpeg({ quality: 80 })
      .toBuffer();
    images.push(new File([buffer], image.name, { type: image.type }));
  }

  return { docs, images };
};

export const createAI = async (hc: Readonly<HandlerContext>) => {
  let args: AxAIArgs | undefined;

  if (aiType === 'big') {
    const apiKey = (await decryptKey(hc, agent.aiBigModel.apiKey)) ?? '';
    args = {
      apiKey,
      config: { model: agent.aiBigModel.model },
      name: agent.aiBigModel.id
    } as AxAIArgs;
  }

  if (aiType === 'small') {
    const apiKey = (await decryptKey(hc, agent.aiSmallModel.apiKey)) ?? '';
    args = {
      apiKey,
      config: { model: agent.aiSmallModel.model },
      name: agent.aiSmallModel.id
    } as AxAIArgs;
  }
  if (!args) {
    throw new Error('Invalid AI type: ' + aiType);
  }

  return new AxAI(args);
};
