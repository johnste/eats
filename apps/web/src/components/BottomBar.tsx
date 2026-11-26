import { useEffect, useRef, type ReactNode } from 'react';

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
  // Measured rather than guessed, since what is in the bar changes its
  // height -- a list of weights grows it a row at a time.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty('--bottombar-h', `${el.offsetHeight}px`),
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--bottombar-h');
    };
  }, []);

  return (
    <div
      ref={ref}
      // As wide as the content column on a wider screen, like the tab bar.
      className="bg-surface/85 border-line fixed inset-x-0 z-20 mx-auto border-t backdrop-blur-md sm:max-w-lg sm:border-x"
      // Whichever is taller: the tab bar it has to clear, or the keyboard
      // covering the bottom of the viewport. When the keyboard is up the tab
      // bar is behind it anyway, so stacking both offsets would leave a gap.
      //
      // Tucked a pixel under the tab bar, which is drawn on top and whose
      // top border then reads as the line between them. Two edges meeting
      // exactly at a fractional position can still be snapped to different
      // device pixels and leave a seam; an overlap cannot.
      style={{
        bottom: 'calc(max(var(--tabbar-h, 3.5rem), var(--keyboard-inset, 0px)) - 1px)',
      }}
    >
      <div className="mx-auto max-w-lg px-4 py-3">{children}</div>
    </div>
  );
}

/** Height to match the bar above it, as measured. */
export function BottomBarSpacer() {
  return <div aria-hidden style={{ height: 'var(--bottombar-h, 6rem)' }} />;
}
