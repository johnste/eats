import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Toast } from './Toast.tsx';

/** No more than one update check this often, however often the app is shown. */
const CHECK_EVERY_MS = 60 * 1000;

/**
 * An update that lands this soon after the app was opened or brought back,
 * before anything has been touched, is applied by reloading straight away.
 */
const QUIET_WINDOW_MS = 10 * 1000;

/**
 * Keeps an installed Eats current.
 *
 * The browser only looks for a new service worker when a page loads, and
 * bringing an installed app back from the background is not a page load --
 * so it is asked again here every time the app is shown or comes back
 * online, at most once a minute. The check is one small request for sw.js,
 * answered "not modified" when nothing changed.
 *
 * When a new version takes over (registerType is autoUpdate, see
 * vite.config.ts), what happens depends on whether you are using the app:
 * if it arrived within a few seconds of opening and nothing has been touched
 * yet, the page reloads onto the new code by itself. Otherwise a notice
 * offers the reload, because reloading out from under someone mid-way
 * through logging a meal would lose what they had typed.
 */
export function UpdatePrompt() {
  const [updated, setUpdated] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const lastCheck = useRef(0);
  // When the app was last opened or brought back, and whether anything has
  // been pressed or typed since.
  const shownAt = useRef(Date.now());
  const touched = useRef(false);

  const check = () => {
    const r = registration.current;
    if (!r || Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
    lastCheck.current = Date.now();
    // Offline, or the server mid-deploy: the next showing will try again.
    r.update().catch(() => {});
  };

  useRegisterSW({
    onRegisteredSW(_url, r) {
      if (!r) return;
      registration.current = r;
      lastCheck.current = Date.now();
      // For an app left open on screen, which never gets hidden and shown.
      setInterval(check, 60 * 60 * 1000);
    },
  });

  useEffect(() => {
    const onShown = () => {
      if (document.visibilityState !== 'visible') return;
      shownAt.current = Date.now();
      touched.current = false;
      check();
    };
    const onTouch = () => {
      touched.current = true;
    };
    document.addEventListener('visibilitychange', onShown);
    window.addEventListener('online', check);
    window.addEventListener('pointerdown', onTouch, { capture: true });
    window.addEventListener('keydown', onTouch, { capture: true });
    return () => {
      document.removeEventListener('visibilitychange', onShown);
      window.removeEventListener('online', check);
      window.removeEventListener('pointerdown', onTouch, { capture: true });
      window.removeEventListener('keydown', onTouch, { capture: true });
    };
    // check reads only refs, so the first render's copy is as good as any.
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Fires when a new worker takes control. On the very first load there was
    // no previous controller, and that is an install rather than an update.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onChange = () => {
      if (!hadController) return;
      const quiet = !touched.current && Date.now() - shownAt.current < QUIET_WINDOW_MS;
      if (quiet) window.location.reload();
      else setUpdated(true);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () =>
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);

  if (!updated) return null;

  return (
    <Toast
      action="Reload"
      onAction={() => window.location.reload()}
      onDismiss={() => setUpdated(false)}
    >
      A new version of Eats is ready.
    </Toast>
  );
}
