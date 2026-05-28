import { describe, expect, it } from 'vitest';

import {
  getRuntimeLanguageInfo,
  isJavaScriptRuntimeLanguage,
  runtimeLanguageToCodeFieldName,
} from './rlm.js';

describe('runtime language helpers', () => {
  it('keeps JavaScript runtimes on the legacy javascriptCode field', () => {
    expect(runtimeLanguageToCodeFieldName('JavaScript')).toBe('javascriptCode');
    expect(runtimeLanguageToCodeFieldName('js')).toBe('javascriptCode');
    expect(runtimeLanguageToCodeFieldName('ecmascript')).toBe('javascriptCode');
    expect(isJavaScriptRuntimeLanguage('Java Script')).toBe(true);
  });

  it('derives non-JavaScript runtime code fields from the language name', () => {
    expect(runtimeLanguageToCodeFieldName('Python')).toBe('pythonCode');
    expect(runtimeLanguageToCodeFieldName('TypeScript')).toBe('typescriptCode');
    expect(runtimeLanguageToCodeFieldName('C#')).toBe('cSharpCode');
    expect(runtimeLanguageToCodeFieldName('C++')).toBe('cPlusPlusCode');
    expect(runtimeLanguageToCodeFieldName('!!!')).toBe('runtimeCode');
  });

  it('defaults missing runtime language metadata to JavaScript', () => {
    expect(getRuntimeLanguageInfo({})).toEqual({
      languageName: 'JavaScript',
      codeFieldName: 'javascriptCode',
      codeFieldTitle: 'Javascript Code',
      codeFenceLanguage: 'js',
      isJavaScript: true,
    });
  });
});
