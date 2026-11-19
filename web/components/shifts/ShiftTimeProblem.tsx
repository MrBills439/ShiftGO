'use client';
import type { AmbiguousChoice, TimeProblem } from '@/lib/shiftTime';

/**
 * Explains a shift time that can't be converted as typed: one skipped by the
 * clocks going forward (choose another time), or one that happens twice when
 * they go back (choose which).
 */
export function ShiftTimeProblem({ problem, chosen, onChoose }: {
  problem: TimeProblem | null;
  /** What has been picked so far; the prompt stays visible showing it. */
  chosen?: { start?: AmbiguousChoice; end?: AmbiguousChoice };
  onChoose: (field: 'start' | 'end', choice: AmbiguousChoice) => void;
}) {
  if (!problem) return null;
  return (
    <div role="alert" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-fg">
      <p>{problem.message}</p>
      {problem.code === 'AMBIGUOUS' && problem.options && (
        <fieldset className="mt-2 space-y-1">
          <legend className="sr-only">Which {problem.field} time?</legend>
          {problem.options.map((o) => (
            <label key={o.choice} className="flex items-center gap-2">
              <input
                type="radio"
                name={`dst-${problem.field}`}
                checked={chosen?.[problem.field] === o.choice}
                onChange={() => onChoose(problem.field, o.choice)}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
