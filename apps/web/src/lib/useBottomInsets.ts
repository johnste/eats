import { useEffect } from 'react';

/** Shorter than any on-screen keyboard, taller than any browser toolbar. */
const MIN_KEYBOARD_PX = 120;

/**
 * Publishes two lengths that the fixed bars position themselves against.
 *
 * --tabbar-h is the tab bar's measured height. It used to be written into the
 * bar above it as 3.5rem plus the safe-area inset, which was already a pixel
 * short of the truth because the tab bar has a top border, and would drift
 * further with a larger system font or a taller translated label.
 *
 * --keyboard-inset is how much of the layout viewport the on-screen keyboard
 * covers. Chrome shrinks the layout viewport for us (interactive-widget=
 * resizes-content), but Firefox on Android does not, so a fixed bar stays
 * pinned to the bottom of a viewport that is now behind the keyboard. The
 * visual viewport knows where the keyboard really is, so ask it.
 */
export function useBottomInsets(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // Positive only when something is covering the bottom of the layout
      // viewport; a browser that resizes for us reports 0 here. Anything
      // short of a keyboard is ignored: Firefox's own toolbar, or a zoomed
      // viewport's rounding, can report a few pixels covered, and acting on
      // that would lift the bars clear of the tab bar for no reason.
      const covered = root.clientHeight - (vv.height + vv.offsetTop);
      root.style.setProperty(
        '--keyboard-inset',
        `${covered >= MIN_KEYBOARD_PX ? covered : 0}px`,
      );
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);
}
