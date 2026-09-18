/**
 * Generate the PWA icons. The mark is the calorie ring from the day view --
 * the thing you actually look at in the app -- so the home-screen icon and the
 * first screen share a shape.
 *
 *   node apps/web/scripts/icons.ts
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function mark(size: number, { padded }: { padded: boolean }): Buffer {
  // Maskable icons get cropped to a circle on some launchers, so the ring is
  // drawn smaller inside the safe zone for that variant.
  const scale = padded ? 0.62 : 0.78;
  const c = size / 2;
  const r = (size * scale) / 2;
  const stroke = size * (padded ? 0.085 : 0.105);
  const circumference = 2 * Math.PI * r;
  const shown = circumference * 0.68;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#12161f"/>
  <g transform="rotate(-90 ${c} ${c})" fill="none" stroke-linecap="round">
    <circle cx="${c}" cy="${c}" r="${r}" stroke="#2a3446" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" stroke="#4ec38a" stroke-width="${stroke}"
            stroke-dasharray="${shown} ${circumference}"/>
  </g>
</svg>`);
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
] as const;

for (const [name, size, padded] of targets) {
  await sharp(mark(size, { padded })).png().toFile(join(OUT, name));
  console.log('wrote', name);
}

await sharp(mark(64, { padded: false }))
  .resize(32, 32)
  .toFile(join(OUT, 'favicon.png'));
console.log('wrote favicon.png');
