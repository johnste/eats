/**
 * Run label photos through the real OCR pipeline and print what came out.
 *
 *   node apps/api/scripts/ocr-check.ts photo1.jpg photo2.jpg ...
 *   node apps/api/scripts/ocr-check.ts --synthetic
 *
 * This is the tool for the accuracy check: photograph ten packages from the
 * kitchen, run them through here, and count how many fields land. Add --text
 * to see what Tesseract actually read, which is where a wrong number is
 * usually explained.
 */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { parseNutritionText } from '../src/lib/ocr/parse.ts';
import { imageToText } from '../src/lib/ocr/tesseract.ts';

const args = process.argv.slice(2);
const showText = args.includes('--text');
const paths = args.filter((a) => !a.startsWith('--'));

/** A clean, synthetic Swedish label -- verifies the plumbing, not photo quality. */
async function syntheticLabel(): Promise<Buffer> {
  const rows: [string, string][] = [
    ['Energi', '1554 kJ / 371 kcal'],
    ['Fett', '6,2 g'],
    ['  varav mättat fett', '1,1 g'],
    ['Kolhydrat', '66 g'],
    ['  varav sockerarter', '8,5 g'],
    ['Fiber', '9,8 g'],
    ['Protein', '11 g'],
    ['Salt', '0,01 g'],
  ];
  const row = (y: number, l: string, r: string) =>
    `<text x="40" y="${y}" font-family="DejaVu Sans" font-size="26">${l}</text>` +
    `<text x="430" y="${y}" font-family="DejaVu Sans" font-size="26">${r}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${120 + rows.length * 44}">
    <rect width="100%" height="100%" fill="#fff"/>
    <g fill="#000">
      <text x="40" y="60" font-family="DejaVu Sans" font-size="28" font-weight="bold">Näringsvärde per 100 g</text>
      ${rows.map((r, i) => row(110 + i * 44, r[0], r[1])).join('')}
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function check(label: string, image: Buffer): Promise<void> {
  const started = Date.now();
  const text = await imageToText(image);
  const r = parseNutritionText(text);
  const ms = Date.now() - started;

  const show = (name: string, f: { value: number | null; confidence: number }) =>
    `${name}=${f.value ?? '--'}${f.value === null ? '' : ` (${f.confidence})`}`;

  console.log(`\n${label}  [${ms}ms, ${r.detectedLanguage}, ${r.column}]`);
  console.log(
    '  ',
    [
      show('kcal', r.kcal100g),
      show('protein', r.protein100g),
      show('carbs', r.carbs100g),
      show('fat', r.fat100g),
    ].join('  '),
  );
  console.log(`   atwater=${r.atwaterOk ? 'ok' : 'FAILED'}  serving=${r.servingG.value ?? '--'}`);
  if (showText) {
    console.log('   --- recognised text ---');
    for (const line of r.rawText.trim().split('\n')) console.log(`   | ${line}`);
  }
}

if (paths.length === 0 || args.includes('--synthetic')) {
  await check('synthetic-swedish', await syntheticLabel());
} else {
  for (const p of paths) {
    try {
      await check(p, await readFile(p));
    } catch (err) {
      console.log(`\n${p}\n   FAILED: ${(err as Error).message}`);
    }
  }
}
