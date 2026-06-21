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
      <section className="rounded-2xl border border-forge-border bg-forge-surface p-5">
        <p className="text-sm text-forge-muted">
          <span aria-hidden className="mr-1.5 text-forge-faint">
            ○
          </span>
          No patients matched the criteria.
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
    <section className="overflow-hidden rounded-2xl border border-forge-border bg-forge-surface">
      <header className="flex items-center justify-between border-b border-forge-border px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-sm text-forge-forged">
          <span aria-hidden className="text-[10px] leading-none">
            ●
          </span>
          {count} {count === 1 ? 'patient' : 'patients'} matched
        </span>
      </header>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  className="sticky top-0 whitespace-nowrap border-b border-forge-border bg-forge-base px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-forge-faint"
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
                className={`transition-colors hover:bg-forge-ember/[0.04] ${
                  ri % 2 === 0 ? 'bg-forge-surface' : 'bg-forge-raised/40'
                }`}
              >
                {columns.map((col) => {
                  const value = (row as ResultRow)[col];
                  const empty = value === null || value === undefined;
                  return (
                    <td
                      key={col}
                      className={`whitespace-nowrap px-4 py-2.5 text-sm ${
                        empty
                          ? 'text-forge-faint'
                          : isIdColumn(col)
                            ? 'font-mono text-xs text-forge-muted'
                            : 'text-forge-text'
                      }`}
                    >
                      {renderCell(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {truncated && (
        <footer className="border-t border-forge-border px-4 py-2 font-mono text-[11px] text-forge-faint">
          Showing first {MAX_ROWS} of {rows.length} rows
        </footer>
      )}
    </section>
  );
}
