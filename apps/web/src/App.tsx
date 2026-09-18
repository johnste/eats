import { type ComponentType, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { UpdatePrompt } from './components/UpdatePrompt.tsx';
import { TabBar } from './components/TabBar.tsx';
import { Spinner } from './components/ui.tsx';
import { useMe, useWarmCache } from './lib/queries.ts';
import { Login } from './routes/Login.tsx';
import { Today } from './routes/Today.tsx';

/**
 * A deploy replaces every hashed chunk, so a tab that has been open across one
 * will ask for a file that no longer exists the moment you navigate. That
 * surfaces as a blank screen rather than an error, so treat a failed chunk
 * fetch as "the app moved underneath me" and reload once.
 *
 * The sessionStorage guard matters: without it, a genuinely missing chunk
 * would reload forever.
 */
const RELOAD_GUARD = 'eats:chunk-reloaded';

function lazyRoute<T extends ComponentType<unknown>>(
  load: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    load().catch((error: unknown) => {
      if (!sessionStorage.getItem(RELOAD_GUARD)) {
        sessionStorage.setItem(RELOAD_GUARD, '1');
        window.location.reload();
      }
      throw error;
    }),
  );
}

// A load that succeeds means we are on a coherent build; forget the guard so a
// later deploy can reload again.
if (typeof sessionStorage !== 'undefined') {
  window.addEventListener('load', () => sessionStorage.removeItem(RELOAD_GUARD));
}

/**
 * Today is the screen the app opens on, so it ships in the main bundle.
 * The rest are split out: Weight pulls in Recharts and Add pulls in the
 * barcode detector's WebAssembly, neither of which should be downloaded
 * before they are needed on a phone connection.
 */
const Add = lazyRoute(() => import('./routes/Add.tsx').then((m) => ({ default: m.Add })));
const NewFood = lazyRoute(() =>
  import('./routes/NewFood.tsx').then((m) => ({ default: m.NewFood })),
);
const Weight = lazyRoute(() =>
  import('./routes/Weight.tsx').then((m) => ({ default: m.Weight })),
);
const Settings = lazyRoute(() =>
  import('./routes/Settings.tsx').then((m) => ({ default: m.Settings })),
);

function Shell() {
  useWarmCache(true);

  return (
    <>
      {/* Bottom padding clears the fixed tab bar plus the home indicator. */}
      <div className="mx-auto max-w-lg px-4 pt-4 pb-28">
        <Suspense fallback={<Spinner label="" />}>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/day/:date" element={<Today />} />
          <Route path="/add" element={<Add />} />
          <Route path="/foods/new" element={<NewFood />} />
          <Route path="/weight" element={<Weight />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </div>
      <TabBar />
      <UpdatePrompt />
    </>
  );
}

export function App() {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="" />
      </div>
    );
  }

  return (
    <BrowserRouter>{me.data ? <Shell /> : <Login />}</BrowserRouter>
  );
}
