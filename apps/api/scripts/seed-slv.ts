/**
 * Seed everyday Swedish staples from Livsmedelsverket's food database.
 *
 *   node apps/api/scripts/seed-slv.ts --dry    # show what would be imported
 *   node apps/api/scripts/seed-slv.ts          # import
 *
 * Data: Livsmedelsverket, Livsmedelsdatabasen, CC BY 4.0.
 * https://www.livsmedelsverket.se/en/about-us/open-data/
 *
 * A curated subset rather than all 2,606 entries: the full database is mostly
 * analysed variants and restaurant dishes, and burying "Mjölk 3%" under forty
 * near-identical rows makes search worse, not better.
 */
import { createDb } from '../src/db/client.ts';
import { foods } from '../src/db/schema.ts';
import { loadEnv } from '../src/env.ts';
import { and, eq } from 'drizzle-orm';

const API = 'https://dataportal.livsmedelsverket.se/livsmedel/api/v1';
// Livsmedelsverket gets the same identifying User-Agent as Open Food Facts.
const env = loadEnv();
const UA = env.OFF_USER_AGENT;

/**
 * Terms matched against Livsmedelsverket's own names, which follow a house
 * style: the plain food first, then qualifiers ("Mjölk fett 3% berikad",
 * "Potatis kokt"). Matching therefore respects word boundaries -- "mjölk" must
 * find "Mjölk fett 3%" and not "Mjölkchoklad", which a plain substring match
 * happily returns because it is shorter.
 */
const WANTED: string[] = [
  // Livsmedelsverket files foods by category first -- meat by animal ("Gris
  // bacon"), sausage under "Korv", cheese under "Ost" -- so terms match that
  // scheme rather than how the food is spoken about.

  // Mejeri och ägg
  'mjölk fett 3', 'mellanmjölk', 'lättmjölk', 'filmjölk fett 3',
  'yoghurt naturell fett 3', 'kvarg', 'vispgrädde', 'matlagningsgrädde',
  'crème fraiche', 'smör fett 80', 'hushållsmargarin', 'ost mozzarella',
  'ost hårdost parmesan fett 29', 'ädelost grönmögelost',
  'ägg kokt', 'ägg rått',
  // Bröd och spannmål
  'bröd vitt', 'bröd rågsikt', 'bröd fullkorn råg', 'havregryn fullkorn',
  'frukostflingor müsli fullkorn', 'frukostflingor majs',
  'pasta fullkorn okokt', 'pasta okokt', 'ris långkornigt okokt',
  'couscous', 'bulgur', 'mjölmålla quinoa okokt', 'vetemjöl',
  // Potatis, rotfrukter och grönsaker
  'potatis kokt', 'potatis rå', 'sötpotatis', 'morot', 'palsternacka',
  'rödbeta', 'kålrot', 'broccoli', 'blomkål', 'vitkål', 'grönkål',
  'spenat', 'tomat', 'gurka', 'paprika röd', 'lök gul', 'purjolök',
  'vitlök', 'champinjon', 'squash', 'majskolv', 'avokado',
  // Baljväxter, nötter och frön
  'bruna bönor', 'kikärtor torkade kokta', 'linser torkade', 'sötmandel',
  'valnötter', 'hasselnötter', 'cashewnötter rostade u. salt',
  'jordnötter torkade', 'solrosfrö',
  'sesamfrö u. skal', 'linfrö',
  // Frukt och bär
  'äpple', 'banan', 'apelsin', 'päron', 'vindruvor', 'kiwi',
  'vattenmelon', 'blåbär', 'jordgubbar', 'hallon', 'lingon', 'russin',
  'dadlar',
  // Kött och chark
  'nöt färs', 'nöt kött rå', 'gris fläskfilé rå', 'gris fläskkotlett',
  'gris bacon rå', 'gris kassler tillagad', 'kyckling bröstfilé',
  'korv falukorv kött', 'korv prinskorv kött', 'korv varmkorv kokt',
  'påläggskorv salami rökt', 'leverpastej', 'blodpudding', 'köttbullar',
  // Fisk och skaldjur
  'lax odlad', 'lax gravad', 'torsk', 'sill', 'makrill', 'strömming',
  'räka kokt', 'tonfisk', 'påläggskaviar',
  // Fett, socker och tillbehör
  'rapsolja', 'olivolja', 'majonnäs', 'socker', 'honung', 'mjölkchoklad',
  'glass vaniljsmak', 'kanelbulle', 'chips', 'ketchup', 'senap',
  'tomatpuré', 'hummus',
  // Husmanskost
  'ärtsoppa', 'pannkaka tunn hemlagad', 'raggmunk', 'janssons frestelse',
  'kåldolmar', 'pytt i panna', 'lasagne', 'pizza',
  // Dryck
  'kaffe bryggt', 'öl', 'apelsinjuice',
];


interface FoodSummary {
  nummer: number;
  namn: string;
}

interface Nutrient {
  namn: string;
  euroFIRkod: string;
  varde: number;
  enhet: string;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * True when `name` begins with `term` and the term ends at a word boundary, so
 * "mjölk" matches "Mjölk fett 3%" but not "Mjölkchoklad".
 *
 * The test is that the next character is not a letter, rather than that it is
 * a space: names qualify with punctuation as often as whitespace, and
 * requiring a space rejected "Mjölk fett 3% berikad" for the term
 * "mjölk fett 3".
 */
function startsAtWord(name: string, term: string): boolean {
  if (!name.startsWith(term)) return false;
  const next = name[term.length];
  return next === undefined || !/\p{L}/u.test(next);
}

/**
 * Best match for a term: an exact name, else a word-boundary prefix -- taking
 * the shortest within whichever tier hits first, since longer names are
 * qualified variants of the plain food.
 *
 * A loose substring tier was tried and removed: it matched "cottage cheese" to
 * a cheesecake and "müsli" to a chocolate müsli bar. A term that finds nothing
 * is reported and fixed; a term that finds the wrong food is silently wrong.
 */
function bestMatch(foods: FoodSummary[], term: string): FoodSummary | null {
  const t = normalise(term);
  const tiers = [
    foods.filter((f) => normalise(f.namn) === t),
    foods.filter((f) => startsAtWord(normalise(f.namn), t)),
  ];
  for (const tier of tiers) {
    if (tier.length === 0) continue;
    return [...tier].sort((a, b) => a.namn.length - b.namn.length)[0]!;
  }
  return null;
}

/** Energy comes as two rows sharing a EuroFIR code; only the unit separates them. */
function macrosOf(nutrients: Nutrient[]) {
  const byCode = (code: string, unit?: string) =>
    nutrients.find(
      (n) => n.euroFIRkod === code && (!unit || n.enhet.toLowerCase() === unit),
    )?.varde;

  return {
    kcal100g: byCode('ENERC', 'kcal'),
    protein100g: byCode('PROT'),
    carbs100g: byCode('CHO'),
    fat100g: byCode('FAT'),
  };
}

const dryRun = process.argv.includes('--dry');

const all = await api<{ livsmedel: FoodSummary[] }>('/livsmedel?offset=0&limit=3000');
console.log(`fetched ${all.livsmedel.length} foods from Livsmedelsverket`);

const chosen = new Map<number, FoodSummary>();
const missed: string[] = [];

for (const term of WANTED) {
  const best = bestMatch(all.livsmedel, term);
  if (!best) {
    missed.push(term);
    continue;
  }
  chosen.set(best.nummer, best);
}

console.log(`matched ${chosen.size} foods; ${missed.length} terms found nothing`);
if (missed.length) console.log('  no match:', missed.join(', '));

const { db, close } = createDb(env.DATABASE_URL, { max: 4 });

let imported = 0;
let skipped = 0;

for (const food of chosen.values()) {
  let nutrients: Nutrient[];
  try {
    nutrients = await api<Nutrient[]>(`/livsmedel/${food.nummer}/naringsvarden`);
  } catch (err) {
    console.log(`  ! ${food.namn}: ${(err as Error).message}`);
    skipped += 1;
    continue;
  }

  const m = macrosOf(nutrients);
  // A food missing any of the four cannot be logged, so it is not worth storing.
  if (
    m.kcal100g === undefined ||
    m.protein100g === undefined ||
    m.carbs100g === undefined ||
    m.fat100g === undefined
  ) {
    console.log(`  - ${food.namn}: incomplete, skipped`);
    skipped += 1;
    continue;
  }

  if (dryRun) {
    console.log(
      `  ${food.namn} — ${m.kcal100g} kcal, ${m.protein100g}P ${m.carbs100g}C ${m.fat100g}F`,
    );
    imported += 1;
    continue;
  }

  // Keyed on the Livsmedelsverket number so a re-run updates rather than duplicates.
  const barcode = `slv:${food.nummer}`;
  const existing = await db
    .select({ id: foods.id })
    .from(foods)
    .where(and(eq(foods.source, 'slv'), eq(foods.barcode, barcode)))
    .limit(1);

  const values = {
    source: 'slv' as const,
    barcode,
    name: food.namn,
    brand: 'Livsmedelsverket',
    kcal100g: m.kcal100g,
    protein100g: m.protein100g,
    carbs100g: m.carbs100g,
    fat100g: m.fat100g,
  };

  if (existing[0]) {
    await db.update(foods).set(values).where(eq(foods.id, existing[0].id));
  } else {
    await db.insert(foods).values(values);
  }
  imported += 1;
}

console.log(`\n${dryRun ? 'would import' : 'imported'}: ${imported}, skipped: ${skipped}`);
await close();
