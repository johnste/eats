import type { ReactNode } from 'react';

/**
 * A single notice pinned above the tab bar. Deliberately not a queue: the only
 * thing that currently speaks here is the update prompt, and stacking toasts
 * over a thumb-sized nav bar would cover the app.
 */
export function Toast({
  children,
  action,
  onAction,
  onDismiss,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-50 mx-auto flex max-w-lg items-center gap-3 px-4"
      style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="bg-raised border-line animate-toast-in flex w-full items-center gap-3 rounded-2xl border p-3 shadow-lg">
        <p className="text-ink flex-1 text-[13px]">{children}</p>
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="text-accent shrink-0 text-[13px] font-medium underline underline-offset-4"
          >
            {action}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-faint grid size-11 shrink-0 place-items-center"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
