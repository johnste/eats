/**
 * Which version of Eats this is, as a date: "2026.11.13-1647".
 *
 * A date because that is what you can compare at a glance -- "is the fix
 * from this afternoon on my phone yet?" -- and because it sorts. It is the
 * last commit's time when the build could see git (local builds), and
 * otherwise the time of the build. Production builds in Docker without the
 * repository's history, but every push deploys within a minute or so, so
 * the build time is the commit time to within that.
 *
 * Written in the viewer's own time zone: it is for reading, and a stamp an
 * hour off from the clock on the wall would only confuse.
 */

const committed = new Date(__COMMIT_TIME__);
const built = new Date(__BUILD_TIME__);

/** When this version was made. */
export const versionDate: Date | null = !Number.isNaN(committed.getTime())
  ? committed
  : !Number.isNaN(built.getTime())
    ? built
    : null;

/** When it was built, which in production is when it was deployed. */
export const buildDate: Date | null = Number.isNaN(built.getTime()) ? null : built;

/** The short commit hash, when the build knew it. */
export const commit: string | null =
  __COMMIT_SHA__ === 'unknown' ? null : __COMMIT_SHA__;

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026.11.13-1647", or null when the build left nothing to go on. */
export const version: string | null = versionDate
  ? `${versionDate.getFullYear()}.${pad(versionDate.getMonth() + 1)}.${pad(
      versionDate.getDate(),
    )}-${pad(versionDate.getHours())}${pad(versionDate.getMinutes())}`
  : null;
