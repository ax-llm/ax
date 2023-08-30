import { IncomingMessage } from 'http';

export type ExtendedIncomingMessage = IncomingMessage & {
  id: string;
  type?: string;
  pathname: string;
  reqBody: string;
  resBody: string;
  startTime: number;
};
