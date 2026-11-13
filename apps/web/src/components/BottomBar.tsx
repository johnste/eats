import type { ReactNode } from 'react';

/**
 * Pins an input just above the tab bar, in reach of a thumb.
 *
 * Opaque, not translucent-and-blurred. Blurring the backdrop of a bar fixed
 * over a scrolling list makes the browser redo that blur every frame, which
 * is most of why scrolling was choppy on Android. The surface was already
 * 95% opaque, so the blur was paying for something nobody could see.
 *
 * The content it belongs to scrolls above it, so screens using this must end
 * with <BottomBarSpacer /> or their last rows sit underneath it.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="bg-raised border-line fixed inset-x-0 z-20 border-t"
      // Whichever is taller: the tab bar it has to clear, or the keyboard
      // covering the bottom of the viewport. When the keyboard is up the tab
      // bar is behind it anyway, so stacking both offsets would leave a gap.
      style={{
        bottom: 'max(var(--tabbar-h, 3.5rem), var(--keyboard-inset, 0px))',
      }}
    >
      <div className="mx-auto max-w-lg px-4 py-3">{children}</div>
    </div>
  );
}

/** Height to match the bar above it; a taller bar passes a taller class. */
export function BottomBarSpacer({ className = 'h-24' }: { className?: string }) {
  return <div aria-hidden className={className} />;
}
