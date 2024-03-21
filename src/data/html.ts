import * as htmlparser2 from 'htmlparser2';

export const HTMLCrawler = (chunkSize = 512) => {
  return (
    queueUrl: (url: string, nextDepth: number) => void,
    data: string,
    nextDepth: number
  ): string[] => {
    const chunks: string[] = [];
    let textBuff = '';
    let validTag = false;

    const parser = new htmlparser2.Parser(
      {
        onopentag(name, attr) {
          if (name === 'a' && attr.href) {
            queueUrl(attr.href, nextDepth);
          }
          if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(name)) {
            validTag = true;
          } else {
            validTag = false;
          }
        },
        ontext(text) {
          if (!validTag) {
            return;
          }
          const cleanText = text.replace(/^(\n|\t|[^a-zA-Z0-9]+)/g, '').trim();

          if (cleanText.length > 10) {
            textBuff += cleanText;
            while (textBuff.length >= chunkSize) {
              chunks.push(textBuff.slice(0, chunkSize));
              textBuff = textBuff.slice(chunkSize);
            }
          }
        },
        onend() {
          if (textBuff.length > 10) {
            chunks.push(textBuff);
          }
        }
      },
      {
        decodeEntities: true
      }
    );
    parser.write(data);
    parser.end();

    return chunks;
  };
};
