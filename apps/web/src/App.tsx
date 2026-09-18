import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { TabBar } from './components/TabBar.tsx';
import { Spinner } from './components/ui.tsx';
import { useMe } from './lib/queries.ts';
import { Login } from './routes/Login.tsx';
import { Today } from './routes/Today.tsx';

/**
 * Today is the screen the app opens on, so it ships in the main bundle.
 * The rest are split out: Weight pulls in Recharts and Add pulls in the
 * barcode detector's WebAssembly, neither of which should be downloaded
 * before they are needed on a phone connection.
 */
const Add = lazy(() => import('./routes/Add.tsx').then((m) => ({ default: m.Add })));
const NewFood = lazy(() =>
  import('./routes/NewFood.tsx').then((m) => ({ default: m.NewFood })),
);
const Weight = lazy(() =>
  import('./routes/Weight.tsx').then((m) => ({ default: m.Weight })),
);
const Settings = lazy(() =>
  import('./routes/Settings.tsx').then((m) => ({ default: m.Settings })),
);

function Shell() {
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
