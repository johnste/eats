import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      // The shadow comes from the [data-card] rule in styles.css, which is
      // unlayered and so beats any utility class anyway. Setting it here too
      // just built a second box-shadow for the browser to discard.
      data-card=""
      className={cx('bg-raised border-line rounded-card border p-4', className)}
    >
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        // 44px minimum: this is a phone app and these are thumb targets.
        'min-h-11 rounded-xl px-4 text-[15px] font-semibold transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variant === 'primary' && 'bg-accent text-surface active:brightness-95',
        // Two pixels, not one: at this palette's contrast a hairline outline
        // disappears against the cream.
        variant === 'ghost' && 'text-ink border-line border-2 active:bg-surface',
        variant === 'danger' &&
          'text-danger border-danger/50 border-2 active:bg-danger/10',
        className,
      )}
    />
  );
}

/**
 * A collapsible card.
 *
 * Built on <details>, which brings keyboard operation, the right screen
 * reader announcement and find-in-page expansion without any of it being
 * written here -- and without adding state that re-renders the page.
 *
 * `hint` is what the section is worth knowing at a glance, so collapsing it
 * hides the controls rather than the answer.
 */
export function Disclosure({
  title,
  description,
  hint,
  defaultOpen,
  children,
}: {
  title: string;
  description?: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      data-card
      className="bg-raised border-line rounded-card group border"
      open={defaultOpen}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-ink flex-1 text-[15px] font-semibold">{title}</span>
        {hint && <span className="text-muted nums text-[13px]">{hint}</span>}
        <svg
          viewBox="0 0 24 24"
          className="text-faint size-4 shrink-0 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="px-4 pt-1 pb-4">
        {description && <p className="text-muted mb-4 text-[13px]">{description}</p>}
        {children}
      </div>
    </details>
  );
}

export function Field({
  label,
  hint,
  suffix,
  invalid,
  autoSelect,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  suffix?: string;
  invalid?: boolean;
  /** Highlight the current value on focus, so typing replaces it. */
  autoSelect?: boolean;
}) {
  // Explicit association rather than relying on the wrapping <label>: with the
  // input nested inside another element, assistive tech was falling back to
  // the placeholder for the accessible name.
  const id = useId();
  const hintId = `${id}-hint`;
  const ref = useRef<HTMLInputElement>(null);

  // autoFocus focuses the input while React is still committing, which is
  // before the delegated focus listener exists -- so an onFocus handler never
  // sees that first focus and the value sits there unselected. Select it here
  // instead, and let onFocus cover every later tap.
  useEffect(() => {
    if (!autoSelect) return;
    const el = ref.current;
    if (el && document.activeElement === el) el.select();
  }, [autoSelect]);

  return (
    <div className="block">
      <label htmlFor={id} className="text-muted mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      <span className="relative block">
        <input
          {...props}
          ref={ref}
          id={id}
          onFocus={(e) => {
            if (autoSelect) e.target.select();
            props.onFocus?.(e);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          className={cx(
            'bg-surface border-line text-ink nums min-h-11 w-full rounded-xl border px-3',
            'placeholder:text-faint focus:border-accent focus:outline-none',
            invalid && 'border-danger',
            suffix && 'pr-12',
            className,
          )}
        />
        {suffix && (
          <span className="text-faint pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
            {suffix}
          </span>
        )}
      </span>
      {hint && (
        <span id={hintId} className="text-faint mt-1 block text-xs">
          {hint}
        </span>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="text-faint flex items-center justify-center gap-2 py-10 text-sm">
      <span
        aria-hidden
        className="border-line border-t-accent size-4 animate-spin rounded-full border-2"
      />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10">
      <p className="text-muted text-sm font-medium">{title}</p>
      {children && <div className="text-faint mt-1 text-[13px]">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-danger text-[13px]">
      {children}
    </p>
  );
}
