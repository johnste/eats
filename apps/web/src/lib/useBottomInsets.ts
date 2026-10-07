import { useEffect } from 'react';

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
      // viewport; a browser that resizes for us reports 0 here.
      const covered = Math.max(0, root.clientHeight - (vv.height + vv.offsetTop));
      root.style.setProperty('--keyboard-inset', `${Math.round(covered)}px`);
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
