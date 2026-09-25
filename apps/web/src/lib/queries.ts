import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  addDays,
  guessMeal,
  toDateKey,
  type Meal,
  type UserResponse,
} from '@eats/shared';
import { useEffect } from 'react';
import { api, ApiError } from './api.ts';

/**
 * How far back the weight chart looks. Exported so the prefetch and the page
 * agree on the query key -- warming a key nothing reads is worse than not
 * warming at all, since it costs a request and still leaves you waiting.
 */
export const WEIGHT_WINDOW_DAYS = 90;

/** Respect an explicit request not to spend bandwidth on speculation. */
function saveDataEnabled(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
    .connection;
  return connection?.saveData === true;
}

export const keys = {
  me: ['me'] as const,
  day: (date: string) => ['day', date] as const,
  recent: (meal?: Meal) => ['recent', meal ?? 'any'] as const,
  brands: ['brands'] as const,
  search: (q: string) => ['search', q] as const,
  goals: ['goals'] as const,
  profile: ['profile'] as const,
  tdee: (goal: string, kgPerWeek: number) => ['tdee', goal, kgPerWeek] as const,
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

export const useRecentFoods = (meal?: Meal) =>
  useQuery({
    queryKey: keys.recent(meal),
    queryFn: () => api.recentFoods(meal),
  });

/** Brands change only when a food is added, so this can sit cached a long while. */
export const useBrands = () =>
  useQuery({
    queryKey: keys.brands,
    queryFn: api.brands,
    staleTime: 10 * 60_000,
  });

export const useGoals = () => useQuery({ queryKey: keys.goals, queryFn: api.goals });

/**
 * Maintenance calories: what holds your weight steady. Null when the profile
 * is too thin to work one out -- the endpoint answers 409 rather than
 * guessing, and a missing number here just means the day view says less.
 *
 * Barely moves, so it is cached for an hour and never retried; a 409 is an
 * answer, not a failure worth asking twice about.
 */
export function useMaintenance(): number | null {
  const q = useQuery({
    queryKey: keys.tdee('maintain', 0),
    queryFn: () => api.tdee('maintain', 0),
    retry: false,
    staleTime: 60 * 60_000,
  });
  return q.data ? Math.round(q.data.tdee) : null;
}

export const useProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: api.profile });

/**
 * Warm the tabs you have not opened yet. Each of these is a small payload and
 * the alternative is a spinner on every first visit; they are fetched once at
 * startup rather than on navigation so the tab is already populated when you
 * get there.
 */
export function useWarmCache(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || saveDataEnabled()) return;
    const today = toDateKey();
    const from = addDays(today, -WEIGHT_WINDOW_DAYS);
    const meal = guessMeal();

    void qc.prefetchQuery({
      // The meal the Add tab will default to, so its list is already there.
      queryKey: keys.recent(meal),
      queryFn: () => api.recentFoods(meal),
    });
    void qc.prefetchQuery({ queryKey: keys.goals, queryFn: api.goals });
    void qc.prefetchQuery({
      queryKey: keys.tdee('maintain', 0),
      queryFn: () => api.tdee('maintain', 0),
      retry: false,
    });
    void qc.prefetchQuery({
      queryKey: keys.weights(from, today),
      queryFn: () => api.weights(from, today),
    });
  }, [enabled, qc]);
}

/**
 * Fetch the days either side of the one being viewed, so swiping between them
 * lands on data that is already there. Bounded to two days because the swipe
 * only ever moves one at a time, and the future has nothing to fetch.
 */
export function usePrefetchAdjacentDays(date: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (saveDataEnabled()) return;
    const today = toDateKey();

    for (const neighbour of [addDays(date, -1), addDays(date, 1)]) {
      if (neighbour > today) continue;
      void qc.prefetchQuery({
        queryKey: keys.day(neighbour),
        queryFn: () => api.day(neighbour),
      });
    }
  }, [date, qc]);
}

/** Invalidate everything a change to the log can affect. */
export function useLogMutations(date: string) {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: keys.day(date) });
    void qc.invalidateQueries({ queryKey: ['recent'] });
  };

  const add = useMutation({ mutationFn: api.addEntry, onSuccess: settle });

  /**
   * Editing can move an entry to another day, so both the day it left and the
   * day it arrived on have to be refetched -- invalidating only the current
   * one leaves the destination showing stale totals until something else
   * happens to refresh it.
   */
  const update = useMutation({
    mutationFn: (vars: {
      id: string;
      grams?: number;
      meal?: string;
      loggedOn?: string;
    }) => api.updateEntry(vars.id, vars),
    onSuccess: (_entry, vars) => {
      settle();
      if (vars.loggedOn) {
        void qc.invalidateQueries({ queryKey: keys.day(vars.loggedOn) });
      }
    },
  });

  /** Log the same food again elsewhere, leaving the original alone. */
  const copy = useMutation({
    mutationFn: api.addEntry,
    onSuccess: (entry) => {
      settle();
      void qc.invalidateQueries({ queryKey: keys.day(entry.loggedOn) });
    },
  });

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
          meals: Record<
            string,
            {
              id: string;
              kcal: number;
              proteinG: number;
              carbsG: number;
              fatG: number;
            }[]
          >;
        };
        const meals = Object.fromEntries(
          Object.entries(day.meals).map(([m, list]) => [
            m,
            list.filter((e) => e.id !== id),
          ]),
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

  return { add, update, copy, remove };
}
