import {
  parseWeight,
  pickSlot,
  splitWeights,
  usualAmount,
  type FoodResponse,
} from '@eats/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * Weighing several things in a row: bread, butter, cheese, each read off the
 * scale and remembered, then matched to foods one search at a time.
 *
 * Each weight is a slot. Picking a food fills one -- the active slot, unless
 * the food's usual amount clearly belongs to another open one (pickSlot) --
 * and nothing is logged until every slot has a food and the whole plate is
 * confirmed, so a half-matched plate never lands on the log.
 */

export interface Slot {
  id: string;
  grams: number;
  /** The food it is going to be logged as, once picked. */
  food?: FoodResponse;
}

interface State {
  /** Whatever is still being typed after the last separator. */
  text: string;
  slots: Slot[];
  activeId: string | null;
  /** The active slot was tapped, so the next pick goes there regardless. */
  forced: boolean;
}

const EMPTY: State = { text: '', slots: [], activeId: null, forced: false };

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/**
 * Weights not yet matched to a food live in localStorage, per day, so a phone
 * call halfway through dinner does not cost you the numbers you had already
 * read off the scale. Storage can be missing or throw (private windows,
 * cleared site data); this is a convenience, so any failure just means
 * starting empty.
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
    };
  } catch {
    return EMPTY;
  }
}

function save(date: string, state: State) {
  try {
    if (!state.text && state.slots.length === 0)
      localStorage.removeItem(storageKey(date));
    else
      localStorage.setItem(
        storageKey(date),
        JSON.stringify({ text: state.text, slots: state.slots }),
      );
  } catch {
    // Unsaved is fine; see load().
  }
}

const toSlots = (grams: number[]): Slot[] =>
  grams.map((g) => ({ id: newId(), grams: g }));

/** Slots still waiting for a food. */
const openOf = (s: State): Slot[] => s.slots.filter((x) => !x.food);

/**
 * The active slot: the one you tapped, else the first still waiting. Null
 * once every weight has its food.
 */
const activeOf = (s: State): Slot | null =>
  s.slots.find((x) => x.id === s.activeId) ?? openOf(s)[0] ?? null;

/** Fold any half-typed weight into a slot, as if a separator had followed it. */
function committed(s: State): State {
  const g = parseWeight(s.text);
  if (g === null) return { ...s, text: '' };
  return { ...s, text: '', slots: [...s.slots, ...toSlots([g])] };
}

export function useWeighIn(date: string) {
  const [state, setState] = useState<State>(() => load(date));
  // Handlers read and write through this, so two actions in one event (commit
  // the typed weight, then take it for a food) see each other's result rather
  // than the render they were both created in.
  const ref = useRef(state);
  // Which day the weights in `ref` belong to, and so which key they are
  // saved under.
  const forDate = useRef(date);

  /**
   * Every change is saved as it is made, not from an effect after the next
   * render: a change that also closes or leaves the screen would otherwise
   * be unmounted before its save ran.
   */
  const apply = (next: State) => {
    ref.current = next;
    save(forDate.current, next);
    setState(next);
  };

  // A different day is a different set of weights.
  useEffect(() => {
    if (forDate.current === date) return;
    forDate.current = date;
    const loaded = load(date);
    ref.current = loaded;
    setState(loaded);
  }, [date]);

  return {
    text: state.text,
    slots: state.slots,
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
     * Put this food on a weight: the slot you tapped, or else the open slot
     * it fits. The slot is returned, filled; null when no slot is open,
     * which is the caller's cue to ask for an amount the usual way.
     */
    take(food: FoodResponse): Slot | null {
      const s = committed(ref.current);
      const active = activeOf(s);
      const open = openOf(s);
      const target =
        s.forced && active
          ? active
          : pickSlot(
              open,
              active && !active.food ? active.id : null,
              usualAmount(food),
            );
      if (!target) {
        apply(s);
        return null;
      }
      const filled = { ...target, food };
      const slots = s.slots.map((x) => (x.id === target.id ? filled : x));
      // On to the next weight still waiting, in the order you weighed.
      apply({ ...s, slots, activeId: null, forced: false });
      return filled;
    },

    /** Every weight has its food, and there is at least one. */
    get ready(): boolean {
      return state.slots.length > 0 && state.slots.every((x) => x.food);
    },

    /** Done with these: they are on the log now. */
    clear() {
      apply({ ...ref.current, slots: [], activeId: null, forced: false });
    },

    /** Back from the log after an undo, ahead of anything typed since. */
    restore(slots: Slot[]) {
      const s = ref.current;
      apply({ ...s, slots: [...slots, ...s.slots], activeId: null, forced: false });
    },
  };
}

export type WeighIn = ReturnType<typeof useWeighIn>;
