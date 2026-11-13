/**
 * Foods whose numbers are a guess rather than read off a label.
 *
 * Before foods had an `estimated` field, an agent logging a guess said so in
 * the name -- "Ballerinakaka (estimated)", "Pasta, kokt (uppskattad)",
 * sometimes inside brackets that held something else too: "Cheddar
 * (Kvibille, uppskattad)". The field replaces that. This reads the marker
 * back out of a name so it can become the flag, and is applied to every
 * food an agent creates, so the habit cannot put the marker back.
 *
 * Migration 0008 does the same to existing rows in SQL. The two must agree;
 * the tests pin both to the same cases.
 */

const MARKERS = new Set([
  'estimated',
  'estimate',
  'est',
  'uppskattad',
  'uppskattat',
  'uppskattade',
  'uppskattning',
]);

const isMarker = (token: string): boolean =>
  MARKERS.has(token.trim().toLowerCase().replace(/\.$/, ''));

/**
 * The name without its estimate marker, and whether it had one. Only whole
 * comma-separated items inside brackets count, so "Estrella chips" and
 * "(hemgjord)" are left alone, and "(hemgjord, uppskattad)" keeps
 * "(hemgjord)".
 */
export function stripEstimateMarker(name: string): {
  name: string;
  estimated: boolean;
} {
  let estimated = false;
  const stripped = name.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    const items = inner.split(',');
    const kept = items.filter((item) => !isMarker(item));
    if (kept.length === items.length) return whole;
    estimated = true;
    return kept.length === 0 ? '' : ` (${kept.map((k) => k.trim()).join(', ')})`;
  });
  return { name: stripped.replace(/\s{2,}/g, ' ').trim(), estimated };
}
