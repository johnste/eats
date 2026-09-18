import { toDateKey } from '@eats/shared';

export function App() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Eats</h1>
      <p className="text-muted mt-2">Scaffold up. Today is {toDateKey()}.</p>
    </main>
  );
}
