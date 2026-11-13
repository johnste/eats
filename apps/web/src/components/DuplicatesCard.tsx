import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Disclosure, ErrorNote, EstimatedMark } from './ui.tsx';
import { api, ApiError } from '../lib/api.ts';

/**
 * Foods that share a name, and a way to fold them together.
 *
 * Only offered when there is something to tidy: an empty section here would
 * be a permanent invitation to go looking for a problem you do not have.
 *
 * Merging cannot be undone, so it is armed before it fires, the same as
 * removing an entry.
 */
export function DuplicatesCard() {
  const qc = useQueryClient();
  const [arming, setArming] = useState<string | null>(null);
  const groups = useQuery({ queryKey: ['duplicates'], queryFn: api.duplicates });

  const merge = useMutation({
    mutationFn: ({ keep, drop }: { keep: string; drop: string[] }) =>
      // One at a time: each merge repoints entries, and a half-finished
      // batch is easier to understand as "three of four moved".
      drop.reduce<Promise<unknown>>(
        (chain, id) => chain.then(() => api.mergeFoods(id, keep)),
        Promise.resolve(),
      ),
    onSuccess: () => {
      setArming(null);
      void qc.invalidateQueries({ queryKey: ['duplicates'] });
      void qc.invalidateQueries({ queryKey: ['foods', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['recent'] });
      void qc.invalidateQueries({ queryKey: ['day'] });
    },
  });

  if (!groups.data || groups.data.length === 0) return null;

  return (
    <Disclosure
      title="Duplicate foods"
      hint={`${groups.data.length}`}
      description="The same food added more than once. Keep one and the rest fold into it — past days keep the numbers they were logged with, only the name changes."
    >
      <div className="space-y-5">
        {groups.data.map((group) => (
          <div key={group.name}>
            <p className="text-ink mb-2 text-[13px] font-medium">{group.name}</p>
            <ul className="space-y-1.5">
              {group.foods.map((food) => {
                const others = group.foods.filter((f) => f.id !== food.id);
                const armed = arming === food.id;
                return (
                  <li key={food.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="text-ink block truncate text-[13px]">
                        {food.brand ?? sourceLabel(food.source)}
                        <EstimatedMark show={food.estimated} />
                      </span>
                      <span className="text-faint nums block text-[11px]">
                        {Math.round(food.kcal100g)} kcal/100g · {food.entries}{' '}
                        {food.entries === 1 ? 'entry' : 'entries'}
                      </span>
                    </span>
                    {armed ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setArming(null)}
                          className="text-muted min-h-11 px-2 text-[13px]"
                        >
                          Cancel
                        </button>
                        <Button
                          onClick={() =>
                            merge.mutate({
                              keep: food.id,
                              drop: others.filter((f) => f.removable).map((f) => f.id),
                            })
                          }
                          disabled={merge.isPending}
                        >
                          {merge.isPending ? 'Merging…' : `Keep this`}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => setArming(food.id)}
                        disabled={!others.some((f) => f.removable)}
                      >
                        Keep
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {merge.error instanceof ApiError && (
        <p className="mt-3">
          <ErrorNote>{merge.error.message}</ErrorNote>
        </p>
      )}
    </Disclosure>
  );
}

const sourceLabel = (source: 'off' | 'custom' | 'slv') =>
  source === 'slv'
    ? 'Livsmedelsverket'
    : source === 'off'
      ? 'Open Food Facts'
      : 'Added by you';
