import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A bottom sheet: reachable with a thumb, and dismissable with Escape. */
export function Sheet({
  title,
  titleMark,
  onClose,
  children,
}: {
  title: string;
  /** Drawn after the title, such as the mark on an estimated food. */
  titleMark?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  // Dismissing plays the sheet back down before it is unmounted. Only the
  // dismissals the sheet owns -- the backdrop and Escape -- can wait for it;
  // a sheet closed by its own Save button is already done with and goes at
  // once, which also feels right: you finished, it is gone.
  const [leaving, setLeaving] = useState(false);
  const dismiss = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind the sheet from scrolling with it.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [dismiss]);

  // Rendered into the body, not where it was written. The day view wraps its
  // content in a positioned, z-indexed element so the swipe glow can sit
  // behind it, and that makes a stacking context: a sheet opened from inside
  // it was trapped below the tab bar however high its own z-index went, so
  // the tab bar painted over the button at the bottom of the sheet and no
  // amount of scrolling could reach it.
  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className={`absolute inset-0 bg-black/45 backdrop-blur-[2px] ${
          leaving ? 'animate-fade-out' : 'animate-fade-in'
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onAnimationEnd={(e) => {
          if (leaving && e.target === e.currentTarget) onClose();
        }}
        className={`bg-raised border-line relative max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t p-5 ${
          leaving ? 'animate-sheet-out' : 'animate-sheet-in'
        }`}
        style={{
          paddingBottom:
            'calc(1.25rem + max(env(safe-area-inset-bottom), var(--keyboard-inset, 0px)))',
        }}
      >
        <div className="bg-line mx-auto mb-4 h-1 w-9 rounded-full" aria-hidden />
        <h2 className="text-ink mb-4 text-base font-semibold">
          {title}
          {titleMark}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
