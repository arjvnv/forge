import { describe, expect, it } from 'vitest';
import {
  chooseEffective,
  classifyColumns,
  isIdDateCol,
  listValidTypes,
  normalizeName,
  validateSpec,
} from './select';
import type { ChartSpec } from './types';

// ── fixtures ─────────────────────────────────────────────────────────────────
const diabetesRows = [
  { patient_id: 'a1', most_recent_a1c: 10.4, control_status: 'poor control (>9%)' },
  { patient_id: 'b2', most_recent_a1c: 6.8, control_status: 'controlled' },
  { patient_id: 'c3', most_recent_a1c: 'no test', control_status: 'no test in period' },
  { patient_id: 'd4', most_recent_a1c: 8.1, control_status: 'controlled' },
  { patient_id: 'e5', most_recent_a1c: 7.2, control_status: 'controlled' },
  { patient_id: 'f6', most_recent_a1c: 9.5, control_status: 'poor control (>9%)' },
];
const bpRows = [
  { patient_id: 'a1', systolic: 120, diastolic: 78, reading_date: '2023-03-01' },
  { patient_id: 'b2', systolic: 132, diastolic: 85, reading_date: '2023-06-02' },
];
const genderRows = [
  { patient_id: 'a1', gender: 'M', birthdate: '1970-01-01' },
  { patient_id: 'b2', gender: 'F', birthdate: '1981-05-09' },
  { patient_id: 'c3', gender: 'M', birthdate: '1992-11-20' },
];
const allIdRows = [
  { patient_id: 'a1', encounter_id: 'e1', reading_date: '2023-01-01' },
  { patient_id: 'b2', encounter_id: 'e2', reading_date: '2023-02-01' },
];
const boolRows = [
  { patient_id: 'a1', on_statin: 'yes' },
  { patient_id: 'b2', on_statin: 'no' },
  { patient_id: 'c3', on_statin: 'yes' },
];

describe('isIdDateCol', () => {
  it('matches id, *_id, date, birthdate, deathdate', () => {
    expect(isIdDateCol('id')).toBe(true);
    expect(isIdDateCol('patient_id')).toBe(true);
    expect(isIdDateCol('reading_date')).toBe(true);
    expect(isIdDateCol('birthdate')).toBe(true);
    expect(isIdDateCol('deathdate')).toBe(true);
    expect(isIdDateCol('most_recent_a1c')).toBe(false);
    expect(isIdDateCol('gender')).toBe(false);
  });
});

describe('normalizeName', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeName('Most_Recent_A1c')).toBe('mostrecenta1c');
    expect(normalizeName('Systolic')).toBe('systolic');
  });
});

describe('classifyColumns', () => {
  it('never classifies id/date columns as numeric or categorical', () => {
    const info = classifyColumns(diabetesRows);
    const pid = info.find((c) => c.name === 'patient_id');
    expect(pid?.kind).toBe('id_date');
    const bd = classifyColumns(genderRows).find((c) => c.name === 'birthdate');
    expect(bd?.kind).toBe('id_date');
  });
  it('classifies a mostly-numeric column as numeric (despite a "no test" sentinel)', () => {
    const info = classifyColumns(diabetesRows);
    expect(info.find((c) => c.name === 'most_recent_a1c')?.kind).toBe('numeric');
  });
  it('classifies a low-cardinality string column as categorical', () => {
    const info = classifyColumns(genderRows);
    expect(info.find((c) => c.name === 'gender')?.kind).toBe('categorical');
  });
  it('classifies a yes/no column as boolean', () => {
    const info = classifyColumns(boolRows);
    expect(info.find((c) => c.name === 'on_statin')?.kind).toBe('boolean');
  });
});

describe('chooseEffective (heuristic, no spec)', () => {
  it('one numeric col -> histogram with known threshold derivation', () => {
    // control_status is categorical, so diabetes rows have a categorical -> bar/donut.
    // Use a pure one-numeric fixture:
    const rows = [
      { patient_id: 'a', most_recent_a1c: 10.4 },
      { patient_id: 'b', most_recent_a1c: 6.8 },
    ];
    const eff = chooseEffective(null, rows, null, 'T');
    expect(eff.type).toBe('histogram');
    expect(eff.value).toBe('most_recent_a1c');
  });
  it('two numeric cols -> scatter', () => {
    const eff = chooseEffective(null, bpRows, null, 'T');
    expect(eff.type).toBe('scatter');
    expect(eff.x).toBe('systolic');
    expect(eff.y).toBe('diastolic');
  });
  it('one low-cardinality categorical (<=5 distinct) -> donut', () => {
    const eff = chooseEffective(null, genderRows, null, 'T');
    expect(eff.type).toBe('donut');
    expect(eff.x).toBe('gender');
  });
  it('a categorical with >5 distinct -> bar', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      patient_id: `p${i}`,
      bucket: `cat${i % 7}`, // 7 distinct
    }));
    const eff = chooseEffective(null, rows, null, 'T');
    expect(eff.type).toBe('bar');
  });
  it('boolean col -> donut', () => {
    const eff = chooseEffective(null, boolRows, null, 'T');
    expect(eff.type).toBe('donut');
    expect(eff.x).toBe('on_statin');
  });
  it('all id/date cols -> kpi', () => {
    const eff = chooseEffective(null, allIdRows, null, 'T');
    expect(eff.type).toBe('kpi');
  });
});

describe('validateSpec', () => {
  const info = classifyColumns(diabetesRows);
  it('accepts a good histogram spec', () => {
    const spec: ChartSpec = { type: 'histogram', value: 'most_recent_a1c' };
    expect(validateSpec(spec, info)).toBe(true);
  });
  it('rejects an unknown enum type', () => {
    expect(validateSpec({ type: 'pie' as never }, info)).toBe(false);
  });
  it('rejects a missing required binding', () => {
    expect(validateSpec({ type: 'histogram' }, info)).toBe(false);
  });
  it('rejects a column not present in the rows', () => {
    expect(validateSpec({ type: 'histogram', value: 'nope' }, info)).toBe(false);
  });
  it('rejects a numeric binding pointed at a non-numeric column', () => {
    expect(validateSpec({ type: 'histogram', value: 'control_status' }, info)).toBe(false);
  });
  it('accepts a scatter spec with two numeric columns', () => {
    const bpInfo = classifyColumns(bpRows);
    expect(validateSpec({ type: 'scatter', x: 'systolic', y: 'diastolic' }, bpInfo)).toBe(true);
  });
});

describe('chooseEffective (spec path)', () => {
  it('uses a valid spec and cleans its thresholds', () => {
    const spec: ChartSpec = {
      type: 'histogram',
      value: 'most_recent_a1c',
      title: 'A1c',
      rationale: 'why',
      thresholds: [
        { value: 9, axis: 'x', label: '9% line' },
        { value: NaN, axis: 'x', label: 'bad' },
      ],
    };
    const eff = chooseEffective(spec, diabetesRows, null, 'fallback');
    expect(eff.source).toBe('spec');
    expect(eff.type).toBe('histogram');
    expect(eff.title).toBe('A1c');
    expect(eff.thresholds).toEqual([{ value: 9, axis: 'x', label: '9% line' }]);
  });
  it('falls back to heuristic when the spec is invalid', () => {
    const spec = { type: 'scatter', x: 'gender', y: 'birthdate' } as ChartSpec;
    const eff = chooseEffective(spec, genderRows, null, 'fallback');
    expect(eff.source).toBe('heuristic');
    expect(eff.type).toBe('donut');
  });
});

describe('chooseEffective (override path)', () => {
  it('honours a valid override and marks it as override', () => {
    const eff = chooseEffective(null, bpRows, 'histogram', 'T');
    expect(eff.source).toBe('override');
    expect(eff.type).toBe('histogram');
  });
  it('ignores an unsatisfiable override and falls back to auto', () => {
    const eff = chooseEffective(null, genderRows, 'scatter', 'T');
    expect(eff.type).not.toBe('scatter');
  });
  it('kpi override is always satisfiable', () => {
    const eff = chooseEffective(null, allIdRows, 'kpi', 'T');
    expect(eff.type).toBe('kpi');
  });
});

describe('listValidTypes', () => {
  it('one numeric -> [histogram, kpi]', () => {
    const rows = [{ patient_id: 'a', v: 1 }, { patient_id: 'b', v: 2 }];
    expect(listValidTypes(rows)).toEqual(['histogram', 'kpi']);
  });
  it('one categorical -> [bar, donut, kpi]', () => {
    expect(listValidTypes(genderRows)).toEqual(['bar', 'donut', 'kpi']);
  });
  it('two numeric -> includes scatter and histogram, always kpi', () => {
    const types = listValidTypes(bpRows);
    expect(types).toContain('scatter');
    expect(types).toContain('histogram');
    expect(types).toContain('kpi');
  });
  it('nothing chartable -> [kpi]', () => {
    expect(listValidTypes(allIdRows)).toEqual(['kpi']);
  });
  it('always includes kpi', () => {
    expect(listValidTypes(diabetesRows)).toContain('kpi');
  });
});
