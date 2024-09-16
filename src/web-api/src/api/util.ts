import { ObjectId } from 'mongodb';

export const objectIds = (ids?: string): ObjectId[] => {
  if (!ids) {
    return [];
  }
  return ids.split(',').map((id) => new ObjectId(id.trim()));
};
