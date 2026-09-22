import { guessMeal, toDateKey, type Meal } from '@eats/shared';
import { useSearchParams } from 'react-router';
import { useNavigate } from 'react-router';
import { FoodPicker } from '../components/FoodPicker.tsx';

/**
 * The Add tab. The same picker the day view opens inline, given the whole
 * screen and a fixed bar for its controls.
 */
export function Add() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const date = params.get('date') ?? toDateKey();
  const meal = (params.get('meal') as Meal | null) ?? guessMeal();
  const focusToken = params.get('focus');

  return (
    <>
      <h1 className="text-ink mb-4 text-lg font-semibold">Add food</h1>
      <FoodPicker
        date={date}
        meal={meal}
        variant="page"
        autoFocusToken={focusToken ?? undefined}
        onDone={() => navigate(date === toDateKey() ? '/' : `/day/${date}`)}
      />
    </>
  );
}
