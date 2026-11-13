import { parseWeight, pickSlot, splitWeights, type FoodResponse } from '@eats/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Weighing several things in a row: bread, butter, cheese, each read off the
 * scale and remembered, then matched to foods one search at a time.
 *
 * Weights you have typed but not yet given a food are slots; a slot with a
 * food is a row, ready to add. The active slot is the one the next pick goes
 * to, unless the food's usual amount clearly belongs to another (pickSlot).
 */

export interface Slot {
  id: string;
  grams: number;
}

export interface Row {
  id: string;
  /** Kept as typed, so a half-edited "12," is not snapped back to 12. */
  grams: string;
  food: FoodResponse;
}

interface State {
  /** Whatever is still being typed after the last separator. */
  text: string;
  slots: Slot[];
  rows: Row[];
  activeId: string | null;
  /** The active slot was tapped, so the next pick goes there regardless. */
  forced: boolean;
}

const EMPTY: State = { text: '', slots: [], rows: [], activeId: null, forced: false };

/** How much of a food you usually have, or its portion, or nothing. */
export const usualFor = (food: FoodResponse): number | null =>
  food.usualGrams ?? food.servings[0]?.grams ?? null;

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/**
 * The draft lives in localStorage, per day, so a phone call halfway through
 * dinner does not cost you the numbers you had already read off the scale.
 * Storage can be missing or throw (private windows, cleared site data); the
 * draft is a convenience, so any failure just means starting empty.
 */
const storageKey = (date: string) => `eats.weighin.${date}`;

function load(date: string): State {
  try {
    const raw = localStorage.getItem(storageKey(date));
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Partial<State>;
    return {
      ...EMPTY,
      text: typeof saved.text === 'string' ? saved.text : '',
      slots: Array.isArray(saved.slots) ? saved.slots : [],
      rows: Array.isArray(saved.rows) ? saved.rows : [],
    };
  } catch {
    return EMPTY;
  }
}

function save(date: string, state: State) {
  try {
    const empty = !state.text && state.slots.length === 0 && state.rows.length === 0;
    if (empty) localStorage.removeItem(storageKey(date));
    else
      localStorage.setItem(
        storageKey(date),
        JSON.stringify({ text: state.text, slots: state.slots, rows: state.rows }),
      );
  } catch {
    // Unsaved is fine; see load().
  }
}

const toSlots = (grams: number[]): Slot[] =>
  grams.map((g) => ({ id: newId(), grams: g }));

/** The active slot, falling back to the first one waiting. */
const activeOf = (s: State): Slot | null =>
  s.slots.find((x) => x.id === s.activeId) ?? s.slots[0] ?? null;

/** Fold any half-typed weight into a slot, as if a separator had followed it. */
function committed(s: State): State {
  const g = parseWeight(s.text);
  if (g === null) return { ...s, text: '' };
  return { ...s, text: '', slots: [...s.slots, ...toSlots([g])] };
}

export function useWeighIn(date: string) {
  const [state, setState] = useState<State>(() => load(date));
  // Handlers read and write through this, so two actions in one event (commit
  // the typed weight, then pick a food) see each other's result rather than
  // the render they were both created in.
  const ref = useRef(state);

  const apply = (next: State) => {
    ref.current = next;
    setState(next);
  };

  // Which day `state` belongs to. Saving is declared before loading on
  // purpose: when the day changes, this render still holds the old day's
  // draft, and it must not be written under the new day's key before that
  // day's own draft has been read.
  const forDate = useRef(date);
  useEffect(() => {
    if (forDate.current === date) save(date, state);
  }, [date, state]);
  useEffect(() => {
    if (forDate.current === date) return;
    forDate.current = date;
    apply(load(date));
  }, [date]);

  return {
    text: state.text,
    slots: state.slots,
    rows: state.rows,
    active: activeOf(state),

    setText(text: string) {
      const { done, rest } = splitWeights(text);
      const s = ref.current;
      apply({ ...s, text: rest, slots: [...s.slots, ...toSlots(done)] });
    },

    /** Enter, or leaving the field: the number being typed is finished. */
    commit() {
      apply(committed(ref.current));
    },

    activate(id: string) {
      apply({ ...ref.current, activeId: id, forced: true });
    },

    removeSlot(id: string) {
      const s = ref.current;
      apply({ ...s, slots: s.slots.filter((x) => x.id !== id) });
    },

    /** Backspace in an empty field takes back the last weight. */
    removeLastSlot() {
      const s = ref.current;
      apply({ ...s, slots: s.slots.slice(0, -1) });
    },

    /**
     * Give a food a weight. Returns false when nothing has been weighed at
     * all, which is the caller's cue to ask for an amount the usual way.
     */
    pick(food: FoodResponse): boolean {
      const s = committed(ref.current);
      const usual = usualFor(food);

      if (s.slots.length === 0) {
        if (s.rows.length === 0) {
          apply(s);
          return false;
        }
        // Weighing is under way but every number has a food: add this one
        // at its usual amount, to be corrected in the list if need be.
        const row = { id: newId(), grams: String(Math.round(usual ?? 100)), food };
        apply({ ...s, rows: [...s.rows, row] });
        return true;
      }

      const slot = pickSlot(s.slots, activeOf(s)?.id ?? null, usual, s.forced)!;
      const slots = s.slots.filter((x) => x.id !== slot.id);
      apply({
        ...s,
        slots,
        rows: [...s.rows, { id: slot.id, grams: String(slot.grams), food }],
        // Back to the order you weighed in.
        activeId: slots[0]?.id ?? null,
        forced: false,
      });
      return true;
    },

    setRowGrams(id: string, grams: string) {
      const s = ref.current;
      apply({ ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, grams } : r)) });
    },

    /**
     * Wrong food: take it off and put its weight back, first in line and
     * active, so the very next pick replaces it.
     */
    unpair(id: string) {
      const s = ref.current;
      const row = s.rows.find((r) => r.id === id);
      if (!row) return;
      const g = parseWeight(row.grams);
      const rows = s.rows.filter((r) => r.id !== id);
      if (g === null) {
        apply({ ...s, rows });
        return;
      }
      apply({
        ...s,
        rows,
        slots: [{ id: row.id, grams: g }, ...s.slots],
        activeId: row.id,
        forced: true,
      });
    },

    removeRow(id: string) {
      const s = ref.current;
      apply({ ...s, rows: s.rows.filter((r) => r.id !== id) });
    },

    /** After adding: the rows are on the log, any unmatched weights stay. */
    clearRows() {
      apply({ ...ref.current, rows: [] });
    },
  };
}

export type WeighIn = ReturnType<typeof useWeighIn>;
