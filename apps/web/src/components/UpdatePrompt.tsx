import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Toast } from './Toast.tsx';

/**
 * Tells you when a new version has taken over, so a long-lived session does
 * not sit on stale code without knowing it.
 *
 * The service worker updates itself (see registerType in vite.config.ts) --
 * this only reports it. Reloading is offered rather than forced, because
 * reloading out from under someone mid-way through logging a meal would lose
 * what they had typed.
 */
export function UpdatePrompt() {
  const [updated, setUpdated] = useState(false);

  useRegisterSW({
    onRegisteredSW(_url, registration) {
      // An installed PWA may run for days without a cold start, so check
      // periodically rather than only at launch.
      if (registration) {
        setInterval(() => void registration.update(), 60 * 60 * 1000);
      }
    },
  });

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Fires when a new worker takes control. On the very first load there was
    // no previous controller, and that is an install rather than an update.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onChange = () => {
      if (hadController) setUpdated(true);
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
