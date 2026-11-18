# gen.axir Reference Notes

Reference files:

- `src/ax/dsp/generate.ts` for request building, structured output fallback,
  tool loop, validation retries, infrastructure retries, and error wrapping.
- `src/ax/dsp/generate*.test.ts` for scripted-client behavioral conformance.

## Novel F1

`eval.axir` owns novel token scoring from `src/ax/dsp/eval.ts`: NFD, lowercase,
ASCII punctuation/articles, ECMAScript whitespace, stopword/history exclusions,
multiset overlap, recall and finite empty pairs. `data/eval-text.json` pins
Unicode 17 tables so C++ and language Unicode versions agree; refresh with
`tools/axir/extractors/eval-text-data.ts` and the referenced UnicodeData file.
The public adapters are `novel_f1_score` (Python/C++/Rust), `NovelF1Score` (Go),
and `Ax.novelF1Score` (Java). `eval-novel-f1.json` derives expected scores from
the TypeScript public utility and runs through all five adapters.

## Ordinary F1

`eval.axir` also owns `@eval_f1`, the ordinary F1 from the same file. It shares
the normalization but excludes nothing: stopwords and the empty tokens that
removed articles and punctuation leave behind all count, as they do in
TypeScript. The public adapters are `f1_score` (Python/C++/Rust), `F1Score`
(Go), and `Ax.f1Score` (Java). `eval-f1.json` derives expected scores from
`AxEvalUtil.f1Score` and runs through all five adapters.
