/**
 * A limiter on wrong guesses.
 *
 * A memorable secret is only safe if guessing is slow, so this is what
 * actually protects `/mcp` -- the phrase's own entropy is a second line, not
 * the first. Two things make it cheap to run:
 *
 * Only *failures* count, and the caller must check the secret before asking
 * this class anything. A correct phrase is then accepted however much
 * guessing is going on, so an attacker cannot lock the owner out by tripping
 * the limit on purpose. That is what makes a global cap safe to have at all,
 * and a global cap is the only thing that helps against a distributed
 * attack, where per-address limits are meaningless.
 *
 * State lives in memory. One container, and a restart clearing the counters
 * only matters to an attacker who can restart the server, who has already won.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Generous for fat fingers, hopeless for a dictionary. */
const PER_IP = 10;
/** ~876k guesses a year against a space of 130 million three-word phrases. */
const GLOBAL = 100;

/** Stops a flood of unique source addresses from growing the map forever. */
const MAX_TRACKED_IPS = 10_000;

export class AttemptLimiter {
  private byIp = new Map<string, number[]>();
  private all: number[] = [];
  private now: () => number;

  /** `now` is injectable so a test can move an hour without waiting one. */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** True when this address must not be allowed another guess right now. */
  blocked(ip: string): boolean {
    const cutoff = this.now() - HOUR_MS;
    this.all = this.all.filter((t) => t > cutoff);
    if (this.all.length >= GLOBAL) return true;

    const hits = (this.byIp.get(ip) ?? []).filter((t) => t > cutoff);
    if (hits.length === 0) this.byIp.delete(ip);
    else this.byIp.set(ip, hits);
    return hits.length >= PER_IP;
  }

  /** Call only when a presented secret was wrong. */
  fail(ip: string): void {
    const at = this.now();
    this.all.push(at);

    if (!this.byIp.has(ip) && this.byIp.size >= MAX_TRACKED_IPS) {
      // Full. The global counter still caught this one, which is the limit
      // that matters when the addresses are this varied.
      return;
    }
    this.byIp.set(ip, [...(this.byIp.get(ip) ?? []), at]);
  }

  /** Seconds until this address may try again, for Retry-After. */
  retryAfter(ip: string): number {
    const cutoff = this.now() - HOUR_MS;
    const mine = (this.byIp.get(ip) ?? []).filter((t) => t > cutoff);
    const pool =
      mine.length >= PER_IP ? mine : this.all.filter((t) => t > cutoff);
    const oldest = pool[0];
    if (oldest === undefined) return 1;
    return Math.max(1, Math.ceil((oldest + HOUR_MS - this.now()) / 1000));
  }
}
