import type { ReactNode } from 'react';

/**
 * Pins an input just above the tab bar, in reach of a thumb.
 *
 * The content it belongs to scrolls above it, so screens using this must end
 * with <BottomBarSpacer /> or their last rows sit underneath it.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="bg-raised/95 border-line fixed inset-x-0 z-20 border-t backdrop-blur"
      // Clears the tab bar (min-h-14) and the home indicator beneath it.
      style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-lg px-4 py-3">{children}</div>
    </div>
  );
}

export function BottomBarSpacer() {
  return <div aria-hidden className="h-24" />;
}
