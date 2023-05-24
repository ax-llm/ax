import { AITokenUsage } from './index';

export type AIGenerateTextExtraOptions = {
  usage: AITokenUsage;
  usageEmbed: AITokenUsage;
  sessionID?: string;
  debug: boolean;
};
