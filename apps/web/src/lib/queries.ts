import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { UserResponse } from '@eats/shared';
import { api, ApiError } from './api.ts';

export const keys = {
  me: ['me'] as const,
  day: (date: string) => ['day', date] as const,
  recent: ['recent'] as const,
  search: (q: string) => ['search', q] as const,
  goals: ['goals'] as const,
  profile: ['profile'] as const,
  tdee: ['tdee'] as const,
  weights: (from: string, to: string) => ['weights', from, to] as const,
};

/** null means "definitely signed out", as opposed to "still loading". */
export function useMe(): UseQueryResult<UserResponse | null> {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    // A 401 is an answer, not a failure worth retrying.
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export const useDay = (date: string) =>
  useQuery({ queryKey: keys.day(date), queryFn: () => api.day(date) });

export const useRecentFoods = () =>
  useQuery({ queryKey: keys.recent, queryFn: api.recentFoods });

export const useGoals = () =>
  useQuery({ queryKey: keys.goals, queryFn: api.goals });

export const useProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: api.profile });

/** Invalidate everything a change to the log can affect. */
export function useLogMutations(date: string) {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: keys.day(date) });
    void qc.invalidateQueries({ queryKey: keys.recent });
  };

  const add = useMutation({ mutationFn: api.addEntry, onSuccess: settle });

  const remove = useMutation({
    mutationFn: api.deleteEntry,
    // Removing an entry should feel instant; the totals recompute from the
    // cached day rather than waiting for a round trip.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: keys.day(date) });
      const previous = qc.getQueryData(keys.day(date));
      qc.setQueryData(keys.day(date), (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const day = old as {
          totals: Record<string, number>;
          meals: Record<string, { id: string; kcal: number; proteinG: number; carbsG: number; fatG: number }[]>;
        };
        const meals = Object.fromEntries(
          Object.entries(day.meals).map(([m, list]) => [m, list.filter((e) => e.id !== id)]),
        );
        const all = Object.values(meals).flat();
        const sum = (k: 'kcal' | 'proteinG' | 'carbsG' | 'fatG') =>
          Math.round(all.reduce((a, e) => a + e[k], 0) * 10) / 10;
        return {
          ...day,
          meals,
          totals: {
            kcal: Math.round(sum('kcal')),
            proteinG: sum('proteinG'),
            carbsG: sum('carbsG'),
            fatG: sum('fatG'),
          },
        };
      });
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.day(date), ctx.previous);
    },
    onSettled: settle,
  });

  return { add, remove };
}
