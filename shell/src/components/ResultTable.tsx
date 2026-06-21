import type { ExecutionResult, ResultRow } from '../types';

interface ResultTableProps {
  result: ExecutionResult | null;
}

const MAX_ROWS = 100;

// Heuristic: render ID-like columns in monospace for scannability.
function isIdColumn(col: string): boolean {
  const c = col.toLowerCase();
  return c === 'id' || c.endsWith('_id') || c.endsWith('id');
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function ResultTable({ result }: ResultTableProps) {
  if (!result) return null;

  const { rows, count } = result;

  if (count === 0 || rows.length === 0) {
    return (
      <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <p className="text-sm text-slate-400">
          No patients matched the criteria
        </p>
      </section>
    );
  }

  const columns =
    result.columns && result.columns.length > 0
      ? result.columns
      : Object.keys(rows[0] as ResultRow);

  const visible = rows.slice(0, MAX_ROWS);
  const truncated = rows.length > MAX_ROWS;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
      <header className="border-b border-slate-700 px-4 py-3">
        <span className="font-semibold text-green-400">
          {count} {count === 1 ? 'patient' : 'patients'} matched
        </span>
      </header>

      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-slate-900">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap px-4 py-2 font-semibold text-slate-300"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, ri) => (
              <tr
                key={ri}
                className={ri % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/50'}
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className={`whitespace-nowrap px-4 py-2 text-slate-200 ${
                      isIdColumn(col) ? 'font-mono text-xs' : ''
                    }`}
                  >
                    {renderCell((row as ResultRow)[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {truncated && (
        <footer className="border-t border-slate-700 px-4 py-2 text-xs text-slate-500">
          Showing first {MAX_ROWS} of {rows.length} rows
        </footer>
      )}
    </section>
  );
}
