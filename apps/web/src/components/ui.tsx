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
      data-card=""
      className={cx(
        'bg-raised border-line rounded-card border p-4 shadow-[var(--shadow-card)]',
        className,
      )}
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
        'min-h-11 rounded-xl px-4 text-[15px] font-medium transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variant === 'primary' && 'bg-accent text-surface active:brightness-95',
        variant === 'ghost' && 'text-ink border-line border active:bg-surface',
        variant === 'danger' &&
          'text-danger border-danger/40 border active:bg-danger/10',
        className,
      )}
    />
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
