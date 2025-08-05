import { describe, expect, it } from 'vitest';

import { axValidateChatRequestMessage } from './validate.js';

describe('axValidateChatRequestMessage', () => {
  describe('user role with media content', () => {
    it('should validate text content', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [{ type: 'text', text: 'Hello world' }],
        })
      ).not.toThrow();
    });

    it('should validate image content', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'image',
              image: 'base64data',
              mimeType: 'image/png',
            },
          ],
        })
      ).not.toThrow();
    });

    it('should validate audio content', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [{ type: 'audio', data: 'base64audiodata' }],
        })
      ).not.toThrow();
    });

    it('should validate file content', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              data: 'base64filedata',
              mimeType: 'application/pdf',
              filename: 'document.pdf',
            },
          ],
        })
      ).not.toThrow();
    });

    it('should validate file content without filename', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              data: 'base64filedata',
              mimeType: 'application/pdf',
            },
          ],
        })
      ).not.toThrow();
    });

    it('should validate file content with fileUri', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              fileUri: 'gs://bucket/file.pdf',
              mimeType: 'application/pdf',
            },
          ],
        })
      ).not.toThrow();
    });

    it('should fail for file content with both data and fileUri', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              data: 'base64filedata',
              fileUri: 'gs://bucket/file.pdf',
              mimeType: 'application/pdf',
            },
          ],
        })
      ).toThrow(/cannot have both 'data' and 'fileUri'/);
    });

    it('should fail for file content with neither data nor fileUri', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              mimeType: 'application/pdf',
            },
          ],
        })
      ).toThrow(/must have either 'data' or 'fileUri'/);
    });

    it('should fail for file content with empty fileUri', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              fileUri: '',
              mimeType: 'application/pdf',
            },
          ],
        })
      ).toThrow(/fileUri cannot be empty/);
    });

    it('should validate url content', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'url',
              url: 'https://example.com',
              title: 'Example',
              description: 'An example URL',
            },
          ],
        })
      ).not.toThrow();
    });

    it('should validate url content without title/description', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'url',
              url: 'https://example.com',
            },
          ],
        })
      ).not.toThrow();
    });

    it('should fail for file content without mimeType', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              data: 'base64filedata',
            },
          ],
        })
      ).toThrow(/must have a mimeType/);
    });

    it('should fail for empty file data', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'file',
              data: '',
              mimeType: 'application/pdf',
            },
          ],
        })
      ).toThrow(/cannot be empty/);
    });

    it('should fail for empty url', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            {
              type: 'url',
              url: '',
            },
          ],
        })
      ).toThrow(/cannot be empty/);
    });

    it('should validate mixed content types', () => {
      expect(() =>
        axValidateChatRequestMessage({
          role: 'user',
          content: [
            { type: 'text', text: 'Check this file:' },
            {
              type: 'file',
              data: 'base64filedata',
              mimeType: 'application/pdf',
            },
            { type: 'text', text: 'And this URL:' },
            {
              type: 'url',
              url: 'https://example.com',
            },
          ],
        })
      ).not.toThrow();
    });
  });
});
