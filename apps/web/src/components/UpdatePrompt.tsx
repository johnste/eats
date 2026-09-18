import { useRegisterSW } from 'virtual:pwa-register/react';
import { Toast } from './Toast.tsx';

/**
 * Tells you when a new version has been deployed, rather than letting the
 * running page quietly diverge from the server.
 *
 * The reload is offered rather than forced: reloading out from under someone
 * mid-way through logging a meal would lose what they had typed.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // A long-lived PWA session may never reload on its own, so check
      // periodically rather than only at startup.
      if (registration) {
        setInterval(() => void registration.update(), 60 * 60 * 1000);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <Toast
      action="Reload"
      onAction={() => void updateServiceWorker(true)}
      onDismiss={() => setNeedRefresh(false)}
    >
      A new version of Eats is available.
    </Toast>
  );
}
