// Refresh with: node --import=tsx tools/axir/extractors/eval-text-data.ts /path/to/UnicodeData.txt
// Unicode 17 data: https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt
// License: https://www.unicode.org/license.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { stopwords } from '../../../src/ax/dsp/stopwords.js';

if (process.versions.unicode !== '17.0')
  throw new Error(
    'Use a Unicode 17 Node runtime to refresh evaluation text tables'
  );
const unicodeLicense = readFileSync(
  'ir/axcore/data/UNICODE-LICENSE.txt',
  'utf8'
);
const ccc: Record<string, number> = {};
for (const line of readFileSync(process.argv[2]!, 'utf8').split('\n')) {
  const fields = line.split(';');
  if (Number(fields[3]))
    ccc[Number.parseInt(fields[0]!, 16)] = Number(fields[3]);
}
const nfd: Record<string, number[]> = {};
const lower: Record<string, number[]> = {};
const cased: Record<string, boolean> = {};
const caseIgnorable: Record<string, boolean> = {};
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const text = String.fromCodePoint(cp);
  const decomposed = text.normalize('NFD');
  // Hangul syllables use the standard algorithm in Core instead of 11,172 rows.
  if (decomposed !== text && (cp < 0xac00 || cp > 0xd7a3))
    nfd[cp] = Array.from(decomposed, (ch) => ch.codePointAt(0)!);
  const folded = text.toLowerCase();
  if (folded !== text)
    lower[cp] = Array.from(folded, (ch) => ch.codePointAt(0)!);
  if (/\p{Cased}/u.test(text)) cased[cp] = true;
  if (/\p{Case_Ignorable}/u.test(text)) caseIgnorable[cp] = true;
}
const punctuation = Object.fromEntries(
  Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', (ch) => [
    ch.codePointAt(0)!,
    true,
  ])
);
const whitespace = Object.fromEntries(
  Array.from(
    '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
    (ch) => [ch.codePointAt(0)!, true]
  )
);
writeFileSync(
  'ir/axcore/data/eval-text.json',
  `${JSON.stringify({ unicode_version: '17.0.0', license: unicodeLicense, source: 'https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt', nfd, ccc, lower, cased, case_ignorable: caseIgnorable, punctuation, whitespace, stopwords: Array.from(stopwords) })}\n`
);
