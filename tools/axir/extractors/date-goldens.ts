// TS-golden date fixtures. TypeScript parses LLM-friendly date text in date,
// datetime, dateRange and datetimeRange output fields
// (src/ax/dsp/datetime.ts, reached through
// src/ax/dsp/extract/fieldValue.ts). The ports do the same when a caller
// opts in with `parse_dates` / `parseDates`, and return what TS's JSON
// serialization of the output gives: Date.prototype.toISOString strings, and
// {start, end} objects of them for ranges.
//
// This extractor writes:
// - ir/axcore/data/date-zone-abbreviations.json: TS's abbreviation tables
//   (literal offsets and rejected abbreviations), copied from
//   src/ax/dsp/datetime.ts so the ports cannot drift from them.
// - ir/axcore/data/date-time-zones.json: the other time-zone names TS
//   (V8/ICU) accepts, grouped under ICU's canonical name. The ports resolve
//   a zone through it before asking their platform tz database for offsets.
//   It depends on the ICU and tz versions of the Node that wrote it, which it
//   records; axir:conformance:check compares it only on a matching Node.
// - ir/conformance/axgen/date-field-values-*.json: the parser corpus, run
//   through TS's validateAndParseFieldValue (kind date_field_value).
// - ir/conformance/axgen/date-*.json: AxGen forward and streamingForward
//   through AxMockAIService, with and without the opt-in.
//
// The goldens pin TS's Intl.DateTimeFormat path: Node 22 and 26 have no
// globalThis.Temporal, so TS never takes its Temporal branch there. The
// extractor refuses to run on a Node that has Temporal, because that branch
// answers some inputs (year 0000 in a named zone) differently.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import type { AxChatResponse } from '../../../src/ax/ai/types.js';
import {
  rejectedTimeZoneAbbreviations,
  timeZoneAbbreviationOffsets,
} from '../../../src/ax/dsp/datetime.js';
import { validateAndParseFieldValue } from '../../../src/ax/dsp/extract/fieldValue.js';
import { AxGen } from '../../../src/ax/dsp/generate.js';
import { AxPromptTemplate } from '../../../src/ax/dsp/prompt.js';
import { type AxField, AxSignature } from '../../../src/ax/dsp/sig.js';
import { mergeDeltas } from '../../../src/ax/dsp/util.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonMap = { [key: string]: Json };

if ((globalThis as { Temporal?: unknown }).Temporal !== undefined) {
  throw new Error(
    'date-goldens: globalThis.Temporal exists on this Node, so TS would take its Temporal branch. The goldens pin the Intl.DateTimeFormat branch; regenerate them on a Node without Temporal (Node 22-26) or update the ports first.'
  );
}

const outRoot = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
const outDir = join(outRoot, 'ir/conformance/axgen');
const dataDir = join(outRoot, 'ir/axcore/data');

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      parentKey === 'input' ||
      parentKey === 'expected_output' ||
      parentKey === 'value' ||
      parentKey === 'delta'
        ? entries
        : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [key, stable(item, key)])
    );
  }
  return value;
}

function writeFixture(name: string, fixture: Record<string, unknown>): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

mkdirSync(outDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

// ----- time-zone abbreviations -----
// TS reads the abbreviations in timeZoneAbbreviationOffsets at their literal
// offset and rejects rejectedTimeZoneAbbreviations, before any Intl lookup.
const abbreviationOffsets = Object.fromEntries(
  Object.entries(timeZoneAbbreviationOffsets).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )
);
const rejectedAbbreviations = [...rejectedTimeZoneAbbreviations].sort();
writeFileSync(
  join(dataDir, 'date-zone-abbreviations.json'),
  `${JSON.stringify(
    {
      generator: 'tools/axir/extractors/date-goldens.ts',
      source: 'src/ax/dsp/datetime.ts',
      offsets_minutes: abbreviationOffsets,
      rejected: rejectedAbbreviations,
    },
    null,
    2
  )}\n`
);
const abbreviationKeys = new Set([
  ...Object.keys(abbreviationOffsets),
  ...rejectedAbbreviations,
]);

// ----- time-zone names -----
// Every other name V8 accepts as Intl.DateTimeFormat's timeZone, grouped
// under ICU's canonical name (resolvedOptions().timeZone). V8 matches names
// case-insensitively; the ports compare lowercased names. The candidates are
// ICU's canonical names, the IANA names in this machine's tz database, every
// one-to-three-letter uppercase ID (ICU's legacy short IDs such as PST, IST
// and BST), and ICU's other legacy names that IANA has dropped. Offset time
// zones (+05:30) are grammar, not names; dates.axir handles them.
function acceptedZone(name: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: name,
    }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function systemTzdataNames(): { names: string[]; version: string } {
  const root = process.env.TZDIR ?? '/usr/share/zoneinfo';
  const zi = join(root, 'tzdata.zi');
  if (!existsSync(zi)) return { names: [], version: 'none' };
  const text = readFileSync(zi, 'utf8');
  const version = /^# version (\S+)/m.exec(text)?.[1] ?? 'unknown';
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'Z') names.push(parts[1]!);
    if (parts[0] === 'L') names.push(parts[2]!);
  }
  return { names, version };
}

function zoneTable() {
  const tzdata = systemTzdataNames();
  const candidates: string[] = [
    ...Intl.supportedValuesOf('timeZone'),
    ...tzdata.names,
    ...[
      'Canada/East-Saskatchewan',
      'US/Pacific-New',
      ...[
        'AST4',
        'AST4ADT',
        'CST6',
        'CST6CDT',
        'EST5',
        'EST5EDT',
        'HST10',
        'MST7',
        'MST7MDT',
        'PST8',
        'PST8PDT',
        'YST9',
        'YST9YDT',
      ].map((id) => `SystemV/${id}`),
    ],
  ];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const shortIds: string[] = [];
  for (const a of letters) {
    shortIds.push(a);
    for (const b of letters) {
      shortIds.push(a + b);
      for (const c of letters) shortIds.push(a + b + c);
    }
  }
  // Four-letter IDs take about 11 s to scan; on Node 26.7 (ICU 78.3) the only
  // ones ICU accepts are the IANA names Cuba, Eire, Iran and Zulu. Scan them
  // with AXIR_DATE_ZONES_FULL_SCAN=1 after an ICU upgrade.
  if (process.env.AXIR_DATE_ZONES_FULL_SCAN === '1') {
    for (const a of letters)
      for (const b of letters)
        for (const c of letters)
          for (const d of letters) shortIds.push(a + b + c + d);
  }
  candidates.push(...shortIds);

  // No ICU legacy short ID may reach Intl: each one is either an IANA name
  // (letters-only links such as Cuba or NZ stay on the Intl path) or in TS's
  // abbreviation tables. The IANA names come from this machine's tz
  // database, so the check needs one.
  const ianaNames = new Set(tzdata.names.map((name) => name.toLowerCase()));
  if (ianaNames.size > 0) {
    const unhandled = shortIds.filter(
      (id) =>
        id.length >= 2 &&
        !ianaNames.has(id.toLowerCase()) &&
        !abbreviationKeys.has(id) &&
        acceptedZone(id) !== undefined
    );
    if (unhandled.length > 0) {
      throw new Error(
        `date-goldens: ICU accepts ${unhandled.join(', ')} as time zones; add them to timeZoneAbbreviationOffsets or rejectedTimeZoneAbbreviations in src/ax/dsp/datetime.ts`
      );
    }
  } else {
    console.warn(
      'date-goldens: no tzdata.zi here (set TZDIR); skipped the ICU short-ID check'
    );
  }

  // The first spelling of a name wins: ICU's and the tz database's own case
  // before a brute-forced uppercase one. TS's abbreviation tables answer
  // those names before Intl, so they are left out.
  const spelled = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  for (const name of candidates) {
    const key = name.toLowerCase();
    if (spelled.has(key) || abbreviationKeys.has(name.toUpperCase())) continue;
    const canonical = acceptedZone(name);
    if (!canonical) continue;
    spelled.set(key, name);
    if (!groups.has(canonical)) groups.set(canonical, new Set([canonical]));
    groups.get(canonical)!.add(name);
  }
  const zones = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([canonical, names]) => [
      canonical,
      ...[...names]
        .filter((name) => name !== canonical)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ]);
  // Lowercased name -> index of its group in zones.
  const keys: Record<string, number> = {};
  zones.forEach((group, index) => {
    for (const name of group) keys[name.toLowerCase()] = index;
  });
  return {
    generator: 'tools/axir/extractors/date-goldens.ts',
    source: {
      node: process.version,
      icu: process.versions.icu,
      tz: process.versions.tz,
      tzdata_candidates: tzdata.version,
    },
    keys,
    zones,
  };
}

// Compact JSON: dates.axir embeds the file in every port, and Java caps a
// string constant at 64 KiB.
writeFileSync(
  join(dataDir, 'date-time-zones.json'),
  `${JSON.stringify(zoneTable())}\n`
);

// ----- parser corpus: validateAndParseFieldValue -----
type FieldSpec = {
  name: string;
  title: string;
  type: 'date' | 'datetime' | 'dateRange' | 'datetimeRange';
  is_array?: boolean;
  is_optional?: boolean;
};

const due: FieldSpec = { name: 'due', title: 'Due', type: 'date' };
const dueDate: FieldSpec = { name: 'dueDate', title: 'Due Date', type: 'date' };
const when: FieldSpec = { name: 'when', title: 'When', type: 'datetime' };
const span: FieldSpec = { name: 'span', title: 'Span', type: 'dateRange' };
const window: FieldSpec = {
  name: 'window',
  title: 'Window',
  type: 'datetimeRange',
};
const optional = (field: FieldSpec): FieldSpec => ({
  ...field,
  is_optional: true,
});
const array = (field: FieldSpec): FieldSpec => ({ ...field, is_array: true });

function tsField(spec: FieldSpec): AxField {
  return {
    name: spec.name,
    title: spec.title,
    type: { name: spec.type, isArray: spec.is_array ?? false },
    isOptional: spec.is_optional ?? false,
  } as AxField;
}

function fixtureField(spec: FieldSpec): JsonMap {
  return {
    name: spec.name,
    title: spec.title,
    type: { name: spec.type, is_array: spec.is_array ?? false },
    is_optional: spec.is_optional ?? false,
  };
}

function fieldCase(spec: FieldSpec, text: string): JsonMap {
  const out: JsonMap = { field: fixtureField(spec), text };
  try {
    const value = validateAndParseFieldValue(tsField(spec), text);
    out.expected =
      value === undefined
        ? { has: false }
        : { has: true, value: clone(value) as Json };
  } catch (error) {
    out.expected_error = (error as Error).message;
  }
  return out;
}

function writeFieldValues(
  name: string,
  description: string,
  cases: [FieldSpec, string[]][]
): void {
  writeFixture(name, {
    kind: 'date_field_value',
    description,
    ts_date_path: 'Intl.DateTimeFormat (no globalThis.Temporal)',
    parse_dates: true,
    cases: cases.flatMap(([spec, texts]) =>
      texts.map((text) => fieldCase(spec, text))
    ),
  });
}

writeFieldValues(
  'date-field-values-date',
  'date fields: YYYY-MM-DD only, JavaScript trim, calendar checks (TS rejects 0000-02-29 because Date.UTC maps years 0-99 to 1900-1999), empty values',
  [
    [
      due,
      [
        '2024-05-09',
        '  2024-05-09  ',
        ' 2024-05-09　',
        '﻿2024-05-09',
        '2024-02-29',
        '2000-02-29',
        '0004-02-29',
        '0000-01-01',
        '0099-12-31',
        '1969-12-31',
        '1970-01-01',
        '9999-12-31',
        '2023-02-29',
        '2024-02-30',
        '1900-02-29',
        '0000-02-29',
        '2024-04-31',
        '2024-13-01',
        '2024-00-10',
        '2024-05-00',
        '2024-5-9',
        '20240509',
        '2024/05/09',
        'May 9, 2024',
        '2024-05-09T00:00:00Z',
        '2024-05-09 extra',
        '​2024-05-09',
        '\u00852024-05-09',
        '\u001c2024-05-09',
        '٢٠٢٤-٠٥-٠٩',
        '２０２４-０５-０９',
        '+2024-05-09',
        '12024-05-09',
        '',
        'null',
        'undefined',
        'NULL  ',
      ],
    ],
    [dueDate, ['2024-02-30', 'soon']],
    [optional(due), ['', 'null', '2024-02-30', 'soon', '2024-05-09']],
  ]
);

writeFieldValues(
  'date-field-values-datetime',
  'datetime fields: Z and numeric offsets, the named-zone form, fractions (truncated to milliseconds), calendar and clock checks, extended ISO years',
  [
    [
      when,
      [
        '2024-05-09T14:30:00Z',
        '2024-05-09T14:30Z',
        '2024-05-09t14:30:00z',
        '2024-05-09 14:30:00Z',
        '2024-05-09T14:30:00.5Z',
        '2024-05-09T14:30:00.123456789Z',
        '2024-05-09T14:30:00.1234567890Z',
        '2024-05-09T14:30.5Z',
        '2024-05-09T14:30:00.Z',
        '2024-05-09T14:30:00+05:30',
        '2024-05-09T14:30:00-08:00',
        '2024-05-09T14:30:00+0530',
        '2024-05-09T14:30:00-0800',
        '2024-05-09T14:30:00+05',
        '2024-05-09T14:30:00UTC+05:30',
        '2024-05-09T14:30:00GMT-0800',
        '2024-05-09T14:30:00utc+05:30',
        '2024-05-09T14:30:00gmt+5',
        '2024-05-09T14:30:00 +05:30',
        '2024-05-09T14:30:00 +05:30',
        '2024-05-09T14:30:00  Z',
        '2024-05-09T14:30:00+24:00',
        '2024-05-09T14:30:00+05:60',
        '2024-05-09T14:30:00-00:00',
        '2024-05-09T14:30:00+23:59',
        '2024-05-09T00:30:00+05:30',
        '2024-02-29T12:00:00Z',
        '2023-02-29T12:00:00Z',
        '2024-02-30T10:00:00Z',
        '2024-05-09T24:00:00Z',
        '2024-05-09T23:60:00Z',
        '2024-05-09T23:59:60Z',
        '2024-05-09',
        '2024-05-09T14:30:00',
        '2024-05-09 14:30',
        '14:30 2024-05-09',
        'garbage',
        '0000-01-01T00:00:00+05:00',
        '0000-12-31T23:59:59Z',
        '9999-12-31T23:00:00-05:00',
        '1969-12-31T23:59:59.999Z',
        '',
      ],
    ],
    [optional(when), ['', 'garbage', '2024-02-30T10:00:00Z']],
  ]
);

writeFieldValues(
  'date-field-values-abbreviations',
  'time-zone abbreviations: the curated ones at their literal offset all year (PST is -08:00 in July), matched case-insensitively over ASCII letters; ambiguous ones and ICU legacy short IDs rejected with a correction; letters-only IANA names (Japan, Cuba, NZ, MET) and POSIX-style names stay on the Intl path',
  [
    [
      when,
      [
        '2024-07-01 12:00 EST',
        '2024-01-15 12:00 EST',
        '2024-07-01 12:00 EDT',
        '2024-07-01 12:00 CDT',
        '2024-07-01 12:00 MST',
        '2024-07-01 12:00 MDT',
        '2024-07-01 12:00 PST',
        '2024-01-15 12:00 PST',
        '2024-07-01 12:00 PDT',
        '2024-07-01 12:00 AKST',
        '2024-07-01 12:00 AKDT',
        '2024-07-01 12:00 HST',
        '2024-07-01 12:00 HDT',
        '2024-07-01 12:00 ADT',
        '2024-07-01 12:00 NDT',
        '2024-07-01 12:00 WET',
        '2024-07-01 12:00 WEST',
        '2024-07-01 12:00 CET',
        '2024-07-01 12:00 CEST',
        '2024-07-01 12:00 EET',
        '2024-07-01 12:00 EEST',
        '2024-07-01 12:00 MSK',
        '2024-07-01 12:00 JST',
        '2024-07-01 12:00 KST',
        '2024-07-01 12:00 HKT',
        '2024-07-01 12:00 SGT',
        '2024-07-01 12:00 AEST',
        '2024-07-01 12:00 AEDT',
        '2024-07-01 12:00 ACST',
        '2024-07-01 12:00 ACDT',
        '2024-07-01 12:00 AWST',
        '2024-07-01 12:00 NZST',
        '2024-07-01 12:00 NZDT',
        '2024-07-01 12:00 WIB',
        '2024-07-01 12:00 PKT',
        '2024-07-01 12:00 NPT',
        '2024-07-01 12:00 SAST',
        '2024-07-01 12:00 CAT',
        '2024-07-01 12:00 EAT',
        '2024-07-01 12:00 WAT',
        '2024-07-01 12:00 BRT',
        '2024-07-01 12:00 ART',
        '2024-07-01 12:00 pst',
        '2024-07-01 12:00 pSt',
        '2024-07-01 12:00 Est',
        '2024-07-01T12:00:00 PDT',
        '2024-07-01 12:00:30.25 NPT',
        '0000-06-15 12:00 PST',
        '2024-07-01 12:00 BST',
        '2024-07-01 12:00 bst',
        '2024-07-01 12:00 IST',
        '2024-07-01 12:00 CST',
        '2024-07-01 12:00 AST',
        '2024-07-01 12:00 SST',
        '2024-07-01 12:00 NST',
        '2024-07-01 12:00 ECT',
        '2024-07-01 12:00 GST',
        '2024-07-01 12:00 ACT',
        '2024-07-01 12:00 AET',
        '2024-07-01 12:00 AGT',
        '2024-07-01 12:00 BET',
        '2024-07-01 12:00 CNT',
        '2024-07-01 12:00 CTT',
        '2024-07-01 12:00 IET',
        '2024-07-01 12:00 MIT',
        '2024-07-01 12:00 NET',
        '2024-07-01 12:00 PLT',
        '2024-07-01 12:00 PNT',
        '2024-07-01 12:00 PRT',
        '2024-07-01 12:00 VST',
        '2024-02-30 12:00 BST',
        '2024-07-01 12:00 Japan',
        '2024-07-01 12:00 Cuba',
        '2024-07-01 12:00 NZ',
        '2024-07-01 12:00 MET',
        '2024-07-01 12:00 EST5EDT',
        '2024-07-01 12:00 PST8PDT',
        '2024-07-01 12:00 ＰＳＴ',
        '2024-07-01 12:00 PSTX',
        '2024-07-01 12:00 P',
      ],
    ],
    [optional(when), ['2024-07-01 12:00 BST']],
    [
      window,
      [
        '2024-07-01 09:00 PST to 2024-07-01 17:00 PST',
        '2024-07-01 09:00 PST to 2024-07-01 17:00 BST',
      ],
    ],
  ]
);

writeFieldValues(
  'date-field-values-zones',
  'datetime fields with a named zone: UTC/GMT/Z names, IANA zones in DST, the DST gap (an error) and overlap (the earlier instant), case-insensitive and legacy names, U+2212 offsets that only Intl reads, LMT seconds, and unknown zones',
  [
    [
      when,
      [
        '2024-05-09 14:30 UTC',
        '2024-05-09 14:30 GMT',
        '2024-05-09 14:30 utc',
        '2024-05-09 14:30 Z',
        '2024-05-09 14:30 z',
        '2024-05-09 14:30 +05:30',
        '2024-05-09 14:30 -0800',
        '2024-05-09 14:30 America/New_York',
        '2024-01-15 09:00 America/New_York',
        '2024-05-09T14:30:00 America/New_York',
        '2024-05-09 14:30 Asia/Kolkata',
        '2024-05-09 14:30:45.678 Asia/Kolkata',
        '2024-07-01 12:00 Europe/London',
        '2024-01-15 12:00 Europe/London',
        '2024-05-09 14:30\nAmerica/New_York',
        '2024-05-09 14:30　Asia/Tokyo',
        '2024-05-09 14:30  America/New_York',
        '2024-03-10 01:59 America/New_York',
        '2024-03-10 02:30 America/New_York',
        '2024-03-10 03:30 America/New_York',
        '2024-11-03 00:59 America/New_York',
        '2024-11-03 01:30 America/New_York',
        '2024-11-03 02:00 America/New_York',
        '2024-03-31 01:30 Europe/London',
        '2024-10-27 01:30 Europe/London',
        '2024-02-29 23:30 America/New_York',
        '2024-05-09 14:30 america/new_york',
        '2024-05-09 14:30 EUROPE/LONDON',
        '2024-05-09 14:30 US/Eastern',
        '2024-05-09 14:30 Asia/Calcutta',
        '2024-05-09 14:30 Etc/GMT+5',
        '2024-05-09 14:30 Etc/UTC',
        '2024-05-09 14:30 GMT0',
        '2024-05-09 14:30 −05:00',
        '2024-05-09 14:30 −0530',
        '2024-05-09 14:30 −05',
        '2024-05-09 14:30 −24:00',
        '2024-05-09T14:30:00−05:00',
        '1800-01-01 12:00 America/New_York',
        '0001-01-01 00:00 Asia/Kolkata',
        '0000-06-15 12:00 America/New_York',
        '0000-06-15 12:00 −05:00',
        '2024-05-09 14:30 Mars/Olympus',
        '2024-05-09 14:30 UTC+5',
        '2024-05-09 14:30 +05:30:00',
        '2024-05-09 14:30 Local',
        '2024-05-09 14:30 localtime',
        '2024-05-09 14:30 posixrules',
        '2024-05-09 14:30 Factory',
        '2024-05-09 14:30 America/New_York/Extra',
        '2024-05-09 14:30 Asia/Hanoi',
        '2024-05-09 14:30 Asia/Kolkata',
        '2024-02-30 10:00 Mars/Olympus',
        '2024-02-30 10:00 America/New_York',
      ],
    ],
    [optional(when), ['2024-03-10 02:30 America/New_York']],
  ]
);

writeFieldValues(
  'date-field-values-ranges',
  'dateRange and datetimeRange fields: JSON objects (start/end, from/to, null falls back), two-item arrays, code fences, start/end intervals, to/through/until/dash delimiters, end before start, and endpoint errors',
  [
    [
      span,
      [
        '2024-05-09/2024-05-12',
        ' 2024-05-09 / 2024-05-12 ',
        '2024-05-09/2024-05-09',
        '{"start":"2024-05-09","end":"2024-05-12"}',
        '{"from":"2024-05-09","to":"2024-05-12"}',
        '{"start":null,"from":"2024-05-09","end":"2024-05-12"}',
        '{"start":"2024-05-09","end":"2024-05-12","extra":1}',
        '["2024-05-09","2024-05-12"]',
        '```json\n{"start":"2024-05-09","end":"2024-05-12"}\n```',
        '```JSON\n["2024-05-09","2024-05-12"]\n```',
        '```\n2024-05-09/2024-05-12\n```',
        '```js\n{"start":"2024-05-09","end":"2024-05-12"}\n```',
        '``````',
        '2024-05-09 to 2024-05-12',
        '2024-05-09 TO 2024-05-12',
        '2024-05-09 through 2024-05-12',
        '2024-05-09 until 2024-05-12',
        '2024-05-09 - 2024-05-12',
        '2024-05-09 – 2024-05-12',
        '2024-05-09 — 2024-05-12',
        '2024-05-09\nto 2024-05-12',
        '2024-05-09 to\n2024-05-12',
        '2024-05-09 to 2024-05-10 to 2024-05-12',
        '2024-05-12/2024-05-09',
        '2024-05-09 -2024-05-12',
        '2024-05-09-2024-05-12',
        '2024-05-09 tomorrow 2024-05-12',
        'garbage',
        '2024-05-09',
        '2024-05-09/2024-05-12/2024-05-13',
        '{"start":"2024-05-09"}',
        '{"start":5,"end":"2024-05-12"}',
        '{"start":false,"end":"2024-05-12"}',
        '[1,2]',
        '["2024-05-09"]',
        '{bad json',
        '"2024-05-09/2024-05-12"',
        '2024-02-30/2024-03-01',
        '2024-05-09T10:00:00Z/2024-05-10T10:00:00Z',
        '2024-05-09\n2024-05-10 to 2024-05-12',
        'May 9 to May 12',
        '',
      ],
    ],
    [
      window,
      [
        '2024-05-09T14:30:00Z/2024-05-09T15:30:00Z',
        '{"start":"2024-05-09T14:30:00Z","end":"2024-05-09T15:30:00+05:30"}',
        '{"start":"2024-05-09T14:30:00+05:30","end":"2024-05-09T14:30:00Z"}',
        '2024-05-09 14:30 America/New_York to 2024-05-09 16:00 America/New_York',
        '2024-05-09 14:30 America/New_York to 2024-05-09T20:00:00Z',
        '2024-05-09 14:30 EST - 2024-05-09 15:30 EST',
        '["2024-05-09T04:30:00Z","2024-05-09 15:30 Asia/Kolkata"]',
        '```json\n{"start":"2024-05-09T14:30:00Z","end":"2024-05-09T15:30:00Z"}\n```',
        '2024-05-09T14:30:00Z/garbage',
        '2024-05-09T14:30:00Z/2024-05-09',
      ],
    ],
    [optional(span), ['garbage', '2024-05-12/2024-05-09']],
    [optional(window), ['', '2024-05-09T14:30:00Z/garbage']],
  ]
);

writeFieldValues(
  'date-field-values-arrays',
  'date-typed array fields: JSON arrays and markdown lists; every item must parse (an optional field does not skip a bad item), and a bad item reports the whole field text',
  [
    [
      array(due),
      [
        '["2024-05-09", "2024-05-10"]',
        '- 2024-05-09\n- 2024-05-10',
        '2024-05-09',
        '[]',
        '["2024-05-09", "2024-02-30"]',
        '[20240509]',
        '["2024-05-09", null]',
      ],
    ],
    [optional(array(due)), ['["2024-05-09", "soon"]']],
    [
      array(when),
      [
        '["2024-05-09T14:30:00Z", "2024-05-09 14:30 America/New_York"]',
        '["2024-05-09T14:30:00Z", "2024-05-09 14:30 Mars/Olympus"]',
      ],
    ],
    [
      array(span),
      [
        '[{"start":"2024-05-09","end":"2024-05-10"}, "2024-05-11/2024-05-12"]',
        '[{"start":"2024-05-10","end":"2024-05-09"}]',
        '[{"from":"2024-05-09"}]',
      ],
    ],
    [array(window), ['[["2024-05-09T14:30:00Z","2024-05-09T15:30:00Z"]]']],
  ]
);

// Inputs that make TS's backtracking regexes slow (CodeQL
// js/polynomial-redos on datetime.ts). The ports scan without regexes, so
// they must answer these in linear time.
const spaces = (count: number) => ' '.repeat(count);
writeFieldValues(
  'date-field-values-adversarial',
  'long adversarial inputs for the patterns TS matches with backtracking regexes; the ports scan them in linear time',
  [
    [
      when,
      [
        `2024-05-09 14:30${spaces(10000)}x\ny`,
        `2024-05-09 14:30${spaces(10000)}America/New_York`,
      ],
    ],
    [
      span,
      [
        `\`\`\`${spaces(800)}x`,
        `\`\`\`json${spaces(800)}{"start":"2024-05-09"`,
        `a${spaces(10000)}b`,
        `a to${spaces(8000)}b\nc`,
        `2024-05-09${spaces(10000)}to${spaces(10000)}2024-05-12`,
        `\`\`\`json${'\n'.repeat(1000)}{"start":"2024-05-09","end":"2024-05-12"}${'\n'.repeat(1000)}\`\`\``,
      ],
    ],
  ]
);

// ----- AxGen forward and streamingForward -----
type ResponseSpec = { stream: JsonMap[] } | { results: JsonMap[] };

function tsResult(result: JsonMap): AxChatResponse['results'][number] {
  const out: Record<string, unknown> = { index: result.index ?? 0 };
  if (result.content !== undefined) out.content = result.content;
  if (result.finish_reason !== undefined)
    out.finishReason = result.finish_reason;
  return out as AxChatResponse['results'][number];
}

function scriptedAI(responses: ResponseSpec[], features: JsonMap | undefined) {
  const queue = clone(responses);
  const requests: unknown[] = [];
  const ai = new AxMockAIService({
    features: {
      functions: true,
      streaming: true,
      structuredOutputs: features?.structured_outputs as boolean | undefined,
    },
    chatResponse: async (request) => {
      requests.push(clone(request));
      const next = queue.shift();
      if (!next) throw new Error('scripted client exhausted');
      if ('results' in next) {
        return { results: next.results.map(tsResult) } as AxChatResponse;
      }
      const chunks = [...next.stream];
      return new ReadableStream<AxChatResponse>({
        pull(controller) {
          const chunk = chunks.shift();
          if (!chunk) {
            controller.close();
          } else {
            controller.enqueue({
              results: ((chunk.results ?? []) as JsonMap[]).map(tsResult),
            } as AxChatResponse);
          }
        },
      });
    },
  });
  return { ai, requests };
}

const optionNames: Record<string, string> = {
  max_retries: 'maxRetries',
  parse_dates: 'parseDates',
};

function tsOptions(options: JsonMap | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    out[optionNames[key] ?? key] = clone(value);
  }
  return out;
}

type GenCase = {
  kind: 'forward' | 'streaming_forward';
  signature: string;
  input?: JsonMap;
  options?: JsonMap;
  forward_options?: JsonMap;
  features?: JsonMap;
  responses: ResponseSpec[];
  // Needles TS's requests must contain (checked here against TS's own
  // requests); the correction text itself is pinned by date_field_value.
  request_contains?: string[];
};

type GenRun = {
  output?: Json;
  deltas: JsonMap[];
  error?: string;
  requests: unknown[];
};

async function runGen(spec: GenCase, signature = spec.signature) {
  const { ai, requests } = scriptedAI(spec.responses, spec.features);
  const gen = new AxGen(signature, tsOptions(spec.options) as never);
  const input = spec.input ?? { question: 'Status?' };
  const run: GenRun = { deltas: [], requests };
  try {
    if (spec.kind === 'forward') {
      run.output = clone(
        (await gen.forward(ai, input, tsOptions(spec.forward_options))) as Json
      );
    } else {
      for await (const delta of gen.streamingForward(
        ai,
        input,
        tsOptions(spec.forward_options)
      )) {
        run.deltas.push(clone(delta) as unknown as JsonMap);
      }
    }
  } catch (error) {
    run.error = (error as Error).message.split('\n')[0];
  }
  return run;
}

function mergedOutput(deltas: JsonMap[]): Json {
  let buffer: { version: number; index: number; delta: object }[] = [];
  let version = 0;
  for (const delta of deltas) {
    if (delta.version !== version) buffer = [];
    version = delta.version as number;
    buffer = mergeDeltas(buffer as never, clone(delta) as never) as never;
  }
  return clone((buffer[0]?.delta ?? {}) as Json);
}

function fixtureBase(spec: GenCase, requests: number): Record<string, unknown> {
  const fixture: Record<string, unknown> = {
    kind: spec.kind,
    signature: spec.signature,
    input: spec.input ?? { question: 'Status?' },
    responses: spec.responses,
    expected_request_count: requests,
  };
  for (const key of ['options', 'forward_options', 'features'] as const) {
    if (spec[key] !== undefined) fixture[key] = spec[key];
  }
  return fixture;
}

// A TS golden: the ports opt in with parse_dates and must match TS.
async function recordGolden(name: string, spec: GenCase): Promise<void> {
  const run = await runGen(spec);
  const fixture = fixtureBase(spec, run.requests.length);
  if (spec.kind === 'streaming_forward') {
    fixture.expected_deltas = run.deltas;
    if (run.error === undefined)
      fixture.expected_output = mergedOutput(run.deltas);
  } else if (run.error === undefined) {
    fixture.expected_output = run.output;
  }
  if (run.error !== undefined) fixture.expected_error_contains = run.error;
  if (spec.request_contains) {
    const text = JSON.stringify(run.requests);
    for (const needle of spec.request_contains) {
      if (!text.includes(needle)) {
        throw new Error(`${name}: TS requests lack ${JSON.stringify(needle)}`);
      }
    }
    fixture.expected_request_contains = spec.request_contains;
  }
  writeFixture(name, fixture);
}

// Port-only: without parse_dates the ports keep the model's text for date
// fields (TS always parses). The same run with the date fields typed as
// strings gives that text; deltas keep TS's sequence for the date-typed run,
// one whole value per field, with the text in place of the parsed value.
async function recordKeepsText(
  name: string,
  spec: GenCase,
  note: string
): Promise<void> {
  const textSignature = spec.signature.replace(
    /:(datetimeRange|dateRange|datetime|date)\b/g,
    ':string'
  );
  const text = await runGen(spec, textSignature);
  if (text.error !== undefined) {
    throw new Error(`${name}: TS failed: ${text.error}`);
  }
  const fixture = fixtureBase(spec, text.requests.length);
  fixture.description = note;
  if (spec.kind === 'forward') {
    fixture.expected_output = text.output;
  } else {
    const parsed = await runGen(spec);
    if (parsed.error !== undefined) {
      throw new Error(`${name}: TS failed: ${parsed.error}`);
    }
    const textValues = mergedOutput(text.deltas) as JsonMap;
    const dateFields = new Set(
      [
        ...spec.signature.matchAll(
          /(\w+)[?!]*:(?:datetimeRange|dateRange|datetime|date)\b/g
        ),
      ].map((match) => match[1]!)
    );
    const deltas = parsed.deltas.map((delta) => {
      const values = delta.delta as JsonMap;
      const replaced: JsonMap = {};
      for (const [key, value] of Object.entries(values)) {
        replaced[key] = dateFields.has(key) ? textValues[key]! : value;
      }
      return { ...delta, delta: replaced };
    });
    fixture.expected_deltas = deltas;
    fixture.expected_output = mergedOutput(deltas);
  }
  writeFixture(name, fixture);
}

const results = (content: string): ResponseSpec => ({
  results: [{ index: 0, content, finish_reason: 'stop' }],
});
const chunk = (content: string): JsonMap => ({
  results: [{ index: 0, content }],
});
const last = (content: string): JsonMap => ({
  results: [{ index: 0, content, finish_reason: 'stop' }],
});
const streamed = (...chunks: JsonMap[]): ResponseSpec => ({ stream: chunks });

const allTypes =
  'question:string -> due:date, when:datetime, span:dateRange, window:datetimeRange, note:string';
const allTypesAnswer =
  'Due: 2024-05-09\nWhen: 2024-05-09 14:30 America/New_York\nSpan: 2024-05-09/2024-05-12\nWindow: {"start":"2024-05-09T14:30:00Z","end":"2024-05-09T15:30:00+00:00"}\nNote: all set';

await recordGolden('date-forward-parse-dates', {
  kind: 'forward',
  signature: allTypes,
  options: { parse_dates: true },
  responses: [results(allTypesAnswer)],
});
await recordGolden('date-forward-parse-dates-forward-option', {
  kind: 'forward',
  signature: allTypes,
  forward_options: { parse_dates: true },
  responses: [results(allTypesAnswer)],
});
await recordGolden('date-forward-parse-dates-forward-wins', {
  kind: 'forward',
  signature: allTypes,
  options: { parse_dates: false },
  forward_options: { parse_dates: true },
  responses: [results(allTypesAnswer)],
});
await recordKeepsText(
  'date-forward-keeps-text-by-default',
  {
    kind: 'forward',
    signature: allTypes,
    responses: [results(allTypesAnswer)],
  },
  'Port-only: without parse_dates (the default until the next major version) date fields keep the model text; TS always parses them.'
);
await recordKeepsText(
  'date-forward-keeps-text-forward-false',
  {
    kind: 'forward',
    signature: allTypes,
    options: { parse_dates: true },
    forward_options: { parse_dates: false },
    responses: [results(allTypesAnswer)],
  },
  'Port-only: parse_dates false on the forward call wins over the constructor and keeps the model text.'
);
await recordKeepsText(
  'date-forward-keeps-invalid-text-by-default',
  {
    kind: 'forward',
    signature: 'question:string -> due:date, when:datetime',
    responses: [results('Due: 2024-02-30\nWhen: next Tuesday')],
  },
  'Port-only: without parse_dates an invalid date is not a validation error; the model text comes back as is.'
);
await recordGolden('date-forward-parse-dates-retry', {
  kind: 'forward',
  signature: 'question:string -> due:date',
  options: { parse_dates: true },
  responses: [results('Due: 2024-02-30'), results('Due: 2024-02-29')],
  request_contains: [
    "Field 'Due' has an invalid value '2024-02-30': Invalid date for 'Due': Invalid date format. Please provide the date in ",
    'Use the exact format YYYY-MM-DD (e.g., 2024-05-09). You provided: 2024-02-30.. Provide a date (YYYY-MM-DD, e.g. 2024-05-09). Ensure formatting exactly matches the expected type.',
  ],
});
await recordGolden('date-forward-parse-dates-zone-retry', {
  kind: 'forward',
  signature: 'question:string -> when:datetime',
  options: { parse_dates: true },
  responses: [
    results('When: 2024-03-10 02:30 America/New_York'),
    results('When: 2024-07-01 12:00 BST'),
    results('When: 2024-07-01 12:00 Europe/London'),
  ],
  request_contains: [
    "Field 'When' has an invalid value '2024-03-10 02:30 America/New_York': Invalid date/time for 'When': Invalid date and time values. Please ensure all components are correct.. Prefer ISO 8601 with an explicit timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00. Legacy values like ",
    "Field 'When' has an invalid value '2024-07-01 12:00 BST': Invalid date/time for 'When': Ambiguous or unsupported time zone abbreviation ",
    '. Please provide an IANA time zone name or a UTC offset. For example, ',
  ],
});
await recordGolden('date-forward-parse-dates-exhausted', {
  kind: 'forward',
  signature: 'question:string -> window:datetimeRange',
  options: { parse_dates: true },
  forward_options: { max_retries: 1 },
  responses: [
    results('Window: 2024-05-09T15:30:00Z/2024-05-09T14:30:00Z'),
    results('Window: sometime'),
  ],
});
await recordGolden('date-forward-parse-dates-optional-invalid', {
  kind: 'forward',
  signature: 'question:string -> answer:string, due?:date',
  options: { parse_dates: true },
  responses: [results('Answer: ok\nDue: whenever')],
});
await recordGolden('date-forward-parse-dates-arrays', {
  kind: 'forward',
  signature:
    'question:string -> dues:date[], spans:dateRange[], summary:string',
  options: { parse_dates: true },
  responses: [
    results(
      'Dues: ["2024-05-09", "2024-05-10"]\nSpans: [{"start":"2024-05-09","end":"2024-05-10"}, "2024-05-11 to 2024-05-12"]\nSummary: two'
    ),
  ],
});
await recordGolden('date-forward-parse-dates-structured-keeps-strings', {
  kind: 'forward',
  signature:
    'question:string -> event:object{name:string, on:date}, due:date, when:datetime',
  options: { parse_dates: true },
  features: { structured_outputs: true },
  responses: [
    results(
      '{"event":{"name":"launch","on":"2024-05-09"},"due":"2024-02-30","when":"2024-05-09 14:30 America/New_York"}'
    ),
  ],
});

const streamedAnswer = streamed(
  chunk('Due: 2024-05'),
  chunk(
    '-09\nWhen: 2024-05-09T14:30:00+05:30\nSpan: 2024-05-09 to 2024-05-12\n'
  ),
  chunk('Window: 2024-05-09T14:30:00Z/2024-05-09T15:30:00Z\nNote: all '),
  last('set')
);
await recordGolden('date-streaming-forward-parse-dates', {
  kind: 'streaming_forward',
  signature: allTypes,
  options: { parse_dates: true },
  responses: [streamedAnswer],
});
await recordGolden('date-streaming-forward-parse-dates-forward-option', {
  kind: 'streaming_forward',
  signature: allTypes,
  forward_options: { parse_dates: true },
  responses: [streamedAnswer],
});
await recordKeepsText(
  'date-streaming-forward-keeps-text-by-default',
  {
    kind: 'streaming_forward',
    signature: allTypes,
    responses: [streamedAnswer],
  },
  'Port-only: without parse_dates streaming deltas carry the model text of each date field, sent whole once the field is complete, as the ports do today.'
);
await recordGolden('date-streaming-forward-parse-dates-retry', {
  kind: 'streaming_forward',
  signature: 'question:string -> when:datetime, note:string',
  options: { parse_dates: true },
  responses: [
    streamed(chunk('When: 2024-02-30T10:00:00Z\nNote: fi'), last('rst')),
    streamed(chunk('When: 2024-07-01 12:00 PST\nNote: sec'), last('ond')),
  ],
});
await recordGolden('date-streaming-forward-parse-dates-structured', {
  kind: 'streaming_forward',
  signature: 'question:string -> event:object{name:string, on:date}, due:date',
  options: { parse_dates: true },
  features: { structured_outputs: true },
  responses: [
    streamed(
      chunk('{"event":{"name":"launch","on":"2024-05-09"},'),
      last('"due":"2024-05-10"}')
    ),
  ],
});

// ----- date inputs: TS processValue -----
// TS renders a Date in a date-typed input (and in examples and demos) as the
// UTC day for a date field, ISO 8601 without milliseconds for a datetime, and
// JSON of those for a {start, end} range of two Dates; an object range with
// anything else is JSON with each Date as toISOString. The ports take their
// native date and time values there: {"$date": iso} is an instant (Python
// aware datetime, Go time.Time, Java Instant or OffsetDateTime) and
// {"$date_only": "YYYY-MM-DD"} a calendar day (Python date, Java LocalDate,
// Go midnight UTC), which TS reads as new Date("YYYY-MM-DD"). Cases with
// native: true need a native type, which Rust and C++ do not have.
const dateMarker = '$date';
const dateOnlyMarker = '$date_only';

function tsNative(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(tsNative);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const instant = record[dateMarker];
    if (typeof instant === 'string') return new Date(instant);
    const day = record[dateOnlyMarker];
    if (typeof day === 'string') return new Date(day);
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, tsNative(item)])
    );
  }
  return value;
}

function hasNative(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasNative);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (dateMarker in record || dateOnlyMarker in record) return true;
    return Object.values(record).some(hasNative);
  }
  return false;
}

const instant = (iso: string) => ({ [dateMarker]: iso });
const day = (iso: string) => ({ [dateOnlyMarker]: iso });
const dateInputSignature =
  'question:string, due?:date, when?:datetime, span?:dateRange, window?:datetimeRange -> answer:string';
const dateInputCases: Record<string, unknown>[] = [
  { due: instant('2024-05-09T23:30:00.000Z') },
  { due: instant('2024-05-09T23:30:00.000-05:00') },
  { due: day('2024-05-09') },
  { due: '2024-05-09' },
  { when: instant('2024-05-09T14:30:00.250Z') },
  { when: instant('2024-05-09T14:30:00+05:30') },
  { when: day('2024-05-09') },
  { when: '2024-05-09 14:30 America/New_York' },
  { span: { start: day('2024-05-09'), end: day('2024-05-12') } },
  {
    span: {
      start: instant('2024-05-09T23:30:00Z'),
      end: instant('2024-05-12T01:00:00+05:30'),
    },
  },
  { span: { start: '2024-05-09', end: '2024-05-12' } },
  { span: { start: instant('2024-05-09T10:00:00.500Z'), end: '2024-05-12' } },
  { span: '2024-05-09/2024-05-12' },
  {
    window: {
      start: instant('2024-05-09T14:30:00.250Z'),
      end: instant('2024-05-09T15:30:00Z'),
      note: 'kept out',
    },
  },
  { window: { start: '2024-05-09T14:30:00Z', end: '2024-05-09T15:30:00Z' } },
  {
    due: day('2024-05-09'),
    when: instant('2024-05-09T14:30:00Z'),
    span: { start: day('2024-05-09'), end: day('2024-05-12') },
    window: { start: '2024-05-09T14:30:00Z', end: '2024-05-09T15:30:00Z' },
  },
];
writeFixture('date-input-values', {
  kind: 'date_input',
  description:
    'native date and time inputs and {start, end} range objects, rendered as TS renders Dates in the user prompt; native: true cases need a native date type',
  signature: dateInputSignature,
  cases: dateInputCases.map((values) => {
    // Fixtures keep object keys sorted, so TS renders the values in the
    // order the ports read them.
    const input = stable({ question: 'When?', ...values }) as Record<
      string,
      unknown
    >;
    const messages = new AxPromptTemplate(
      AxSignature.create(dateInputSignature)
    ).render(tsNative(input) as never, {});
    const content = messages[messages.length - 1]!.content;
    if (typeof content !== 'string') {
      throw new Error('date-input-values: expected a text user message');
    }
    return {
      values: input,
      native: hasNative(input),
      expected_user_content: content,
    };
  }),
});
