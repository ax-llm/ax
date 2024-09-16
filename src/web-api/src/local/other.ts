import { ObjectId } from 'mongodb';
import { z } from 'zod';

export const IdSchema = z.instanceof(ObjectId);
