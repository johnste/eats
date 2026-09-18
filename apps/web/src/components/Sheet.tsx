import { useEffect, type ReactNode } from 'react';

/** A bottom sheet: reachable with a thumb, and dismissable with Escape. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind the sheet from scrolling with it.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-raised border-line relative max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t p-5"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div className="bg-line mx-auto mb-4 h-1 w-9 rounded-full" aria-hidden />
        <h2 className="text-ink mb-4 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
