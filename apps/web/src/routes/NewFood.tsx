import { atwaterAgrees, toDateKey, type OcrResponse } from '@eats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { BarcodeScanner } from '../components/BarcodeScanner.tsx';
import { CameraSheet } from '../components/CameraSheet.tsx';
import { Button, Card, ErrorNote, Field } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useBrands } from '../lib/queries.ts';

type FieldName = 'kcal100g' | 'protein100g' | 'carbs100g' | 'fat100g';

const NUMERIC: { name: FieldName; label: string; suffix: string }[] = [
  { name: 'kcal100g', label: 'Calories', suffix: 'kcal' },
  { name: 'protein100g', label: 'Protein', suffix: 'g' },
  { name: 'carbs100g', label: 'Carbs', suffix: 'g' },
  { name: 'fat100g', label: 'Fat', suffix: 'g' },
];

/** Anything the parser wasn't sure about gets flagged for a human look. */
const UNCERTAIN = 0.8;

/**
 * What the scan actually saw. Shown after every scan, not just failures: when
 * a number comes out wrong the recognised text is nearly always the
 * explanation, and without it a bad scan is just a mystery.
 */
function ScanReport({ scan, flagged }: { scan: OcrResponse; flagged: number }) {
  const found = [scan.kcal100g, scan.protein100g, scan.carbs100g, scan.fat100g].filter(
    (f) => f.value !== null,
  ).length;
  const text = scan.rawText.trim();

  return (
    <div className="mt-3 space-y-2">
      <p className="text-faint text-[13px]">
        {found === 0
          ? "Couldn't find a nutrition table in that photo. Check the text below — if it's empty or garbled, try again with the table filling the frame, straight on and in good light."
          : found < 4
            ? `Found ${found} of 4 values. Fill in the rest by hand.`
            : flagged === 0
              ? 'Read cleanly. Check it against the packet before saving.'
              : `Check the highlighted ${flagged === 1 ? 'value' : 'values'} — the scan wasn't sure.`}
      </p>

      <details className="group">
        <summary className="text-muted cursor-pointer text-[13px] underline underline-offset-4">
          What the scan read
        </summary>
        <div className="text-faint mt-2 space-y-1 text-[11px]">
          <p className="nums">
            language: {scan.detectedLanguage} · column: {scan.column} · macros{' '}
            {scan.atwaterOk ? 'add up' : "don't add up"}
          </p>
          <pre className="bg-surface border-line max-h-60 overflow-auto rounded-lg border p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
            {text.length > 0 ? text : '(no text recognised)'}
          </pre>
        </div>
      </details>
    </div>
  );
}

export function NewFood() {
  const [params] = useSearchParams();
  const { id: editingId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const date = params.get('date') ?? toDateKey();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(params.get('name') ?? '');
  const [brand, setBrand] = useState(params.get('brand') ?? '');
  const [barcode, setBarcode] = useState(params.get('barcode') ?? '');
  const [scanningBarcode, setScanningBarcode] = useState(false);
  /** label + grams pairs, e.g. "1 egg" -> 60. */
  const [servings, setServings] = useState<{ label: string; grams: string }[]>([]);
  /** The photo the macros came from, kept only to check them against. */
  const [photo, setPhoto] = useState<string | null>(null);
  const [values, setValues] = useState<Record<FieldName, string>>({
    kcal100g: '',
    protein100g: '',
    carbs100g: '',
    fat100g: '',
  });
  const [flagged, setFlagged] = useState<Set<FieldName>>(new Set());
  const [scan, setScan] = useState<OcrResponse | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const brands = useBrands();

  // Editing loads the food and fills the same form; there is no second screen.
  const existing = useQuery({
    queryKey: ['food', editingId],
    queryFn: () => api.food(editingId as string),
    enabled: Boolean(editingId),
  });

  useEffect(() => {
    const food = existing.data;
    if (!food) return;
    setName(food.name);
    setBrand(food.brand ?? '');
    setBarcode(food.barcode ?? '');
    setValues({
      kcal100g: String(food.kcal100g),
      protein100g: String(food.protein100g),
      carbs100g: String(food.carbs100g),
      fat100g: String(food.fat100g),
    });
    setServings(food.servings.map((s) => ({ label: s.label, grams: String(s.grams) })));
  }, [existing.data]);

  const ocr = useMutation({
    mutationFn: async (file: File) => {
      // Held as an object URL rather than a data URL: no base64 inflation, and
      // it is revoked when the component unmounts.
      setPhoto((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
      return api.scanLabel(file);
    },
    onSuccess: (result) => {
      setScan(result);
      // Nothing is saved here -- the numbers land in the fields you were going
      // to fill in anyway, and you confirm them.
      const next = { ...values };
      const flags = new Set<FieldName>();
      for (const { name: key } of NUMERIC) {
        const field = result[key];
        if (field.value !== null) next[key] = String(field.value);
        if (field.value === null || field.confidence < UNCERTAIN) flags.add(key);
      }
      setValues(next);
      setFlagged(flags);
    },
  });

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );

  const parsed = Object.fromEntries(
    NUMERIC.map(({ name: k }) => [k, Number.parseFloat(values[k].replace(',', '.'))]),
  ) as Record<FieldName, number>;

  const complete =
    name.trim().length > 0 &&
    NUMERIC.every(({ name: k }) => Number.isFinite(parsed[k]) && parsed[k] >= 0);

  // The same cross-check the parser uses, run live as you correct the numbers.
  const reconciles =
    complete &&
    atwaterAgrees({
      kcal: parsed.kcal100g,
      proteinG: parsed.protein100g,
      carbsG: parsed.carbs100g,
      fatG: parsed.fat100g,
    });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        brand: brand.trim() || null,
        barcode: barcode || null,
        kcal100g: parsed.kcal100g,
        protein100g: parsed.protein100g,
        carbs100g: parsed.carbs100g,
        fat100g: parsed.fat100g,
        servings: [
          ...servings.flatMap((s) => {
            const grams = Number.parseFloat(s.grams.replace(',', '.'));
            return s.label.trim() && Number.isFinite(grams) && grams > 0
              ? [{ label: s.label.trim(), grams }]
              : [];
          }),
          // The label's own declared portion, if the scan found one and you
          // have not already described the same thing yourself.
          ...(scan?.servingG.value && servings.length === 0
            ? [{ label: '1 portion', grams: scan.servingG.value }]
            : []),
        ],
      };
      return editingId ? api.updateFood(editingId, body) : api.createFood(body);
    },
    onSuccess: () => {
      // The edited food may be sitting in a search result or the recent list.
      void qc.invalidateQueries({ queryKey: ['food', editingId] });
      void qc.invalidateQueries({ queryKey: ['recent'] });
      void qc.invalidateQueries({ queryKey: ['search'] });
      navigate(`/add?date=${date}`);
    },
  });

  return (
    <>
      <h1 className="text-ink mb-1 text-lg font-semibold">
        {editingId ? 'Edit food' : 'New food'}
      </h1>
      <p className="text-muted mb-4 text-[13px]">
        Values are per 100 g, the way labels state them.
      </p>

      {existing.isError && (
        <p className="mb-4">
          <ErrorNote>Couldn&apos;t load that food.</ErrorNote>
        </p>
      )}

      {editingId && (
        <p className="text-faint mb-4 text-xs">
          Entries you have already logged keep the values they were logged with; editing
          only changes this food going forward.
        </p>
      )}

      <Card className="mb-4">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) ocr.mutate(file);
            e.target.value = '';
          }}
        />
        <Button
          variant="ghost"
          className="w-full"
          disabled={ocr.isPending}
          onClick={() => setCameraOpen(true)}
        >
          {ocr.isPending ? 'Reading the label…' : 'Scan nutrition label'}
        </Button>

        {ocr.error instanceof ApiError && (
          <p className="mt-3">
            <ErrorNote>{ocr.error.message}</ErrorNote>
          </p>
        )}

        {photo && (
          <figure className="mt-3">
            <img
              src={photo}
              alt="The label you photographed"
              className="border-line max-h-56 w-full rounded-xl border object-contain"
            />
            <figcaption className="text-faint mt-1 text-center text-[11px]">
              Check the values below against this.
            </figcaption>
          </figure>
        )}

        {scan && <ScanReport scan={scan} flagged={flagged.size} />}
      </Card>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Havregryn"
          required
        />
        {/* A datalist rather than a custom dropdown: it autocompletes as you
            type, still accepts a brand nobody has entered before, and uses the
            platform's own picker on a phone. */}
        <Field
          label="Brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Optional"
          list="known-brands"
          autoComplete="off"
          hint={
            brands.data && brands.data.length > 0
              ? 'Start typing to pick one you have used before.'
              : undefined
          }
        />
        <datalist id="known-brands">
          {(brands.data ?? []).map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>

        <div className="grid grid-cols-2 gap-3">
          {NUMERIC.map(({ name: key, label, suffix }) => (
            <Field
              key={key}
              label={label}
              suffix={suffix}
              inputMode="decimal"
              value={values[key]}
              invalid={flagged.has(key)}
              hint={flagged.has(key) ? 'Check this' : undefined}
              onChange={(e) => {
                setValues({ ...values, [key]: e.target.value });
                // Once you've touched it, it's yours -- stop flagging it.
                if (flagged.has(key)) {
                  const next = new Set(flagged);
                  next.delete(key);
                  setFlagged(next);
                }
              }}
              required
            />
          ))}
        </div>

        {complete && !reconciles && (
          <p className="text-muted text-[13px]">
            These macros don't add up to the calories. That usually means one number was
            misread — worth a second look, but you can save anyway.
          </p>
        )}

        <div>
          <span className="text-muted mb-1.5 block text-[13px] font-medium">
            Barcode
          </span>
          {barcode ? (
            <div className="border-line flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
              <span className="nums text-ink text-[13px]">{barcode}</span>
              <button
                type="button"
                onClick={() => setBarcode('')}
                className="text-muted text-[13px] underline underline-offset-4"
              >
                Remove
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setScanningBarcode(true)}
            >
              Scan a barcode
            </Button>
          )}
          <span className="text-faint mt-1 block text-xs">
            Optional. Attaching one means scanning this packet finds it next time.
          </span>
        </div>

        {/* Portion shortcuts. Grams is still what gets stored -- these only
            save you working out what a portion weighs every time. */}
        <fieldset>
          <legend className="text-muted mb-1.5 text-[13px] font-medium">
            Portion sizes
          </legend>
          <p className="text-faint mb-2 text-xs">
            Optional. "1 egg" or "1 slice", so you can tap instead of weighing.
          </p>

          <div className="space-y-2">
            {servings.map((serving, i) => (
              <div key={i} className="flex items-end gap-2">
                <input
                  aria-label={`Portion ${i + 1} name`}
                  value={serving.label}
                  placeholder="1 egg"
                  onChange={(e) =>
                    setServings(
                      servings.map((s, j) =>
                        j === i ? { ...s, label: e.target.value } : s,
                      ),
                    )
                  }
                  className="bg-surface border-line text-ink placeholder:text-faint focus:border-accent min-h-11 flex-1 rounded-xl border px-3 focus:outline-none"
                />
                <input
                  aria-label={`Portion ${i + 1} weight in grams`}
                  value={serving.grams}
                  placeholder="60"
                  inputMode="decimal"
                  onChange={(e) =>
                    setServings(
                      servings.map((s, j) =>
                        j === i ? { ...s, grams: e.target.value } : s,
                      ),
                    )
                  }
                  className="bg-surface border-line text-ink placeholder:text-faint nums focus:border-accent min-h-11 w-20 rounded-xl border px-3 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={`Remove portion ${i + 1}`}
                  onClick={() => setServings(servings.filter((_, j) => j !== i))}
                  className="text-faint active:text-danger grid size-11 shrink-0 place-items-center"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setServings([...servings, { label: '', grams: '' }])}
            className="text-accent mt-2 text-[13px] underline underline-offset-4"
          >
            {servings.length === 0 ? 'Add a portion size' : 'Add another'}
          </button>

          {scan?.servingG.value && servings.length === 0 && (
            <p className="text-faint mt-2 text-xs">
              The label declares {scan.servingG.value} g per portion; it will be saved
              as &quot;1 portion&quot; unless you describe one yourself.
            </p>
          )}
        </fieldset>

        {save.error instanceof ApiError && <ErrorNote>{save.error.message}</ErrorNote>}

        <Button type="submit" className="w-full" disabled={!complete || save.isPending}>
          {save.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Save food'}
        </Button>
      </form>

      {scanningBarcode && (
        <BarcodeScanner
          hint="Hold the packet's barcode inside the frame."
          onClose={() => setScanningBarcode(false)}
          onFound={(code) => {
            setScanningBarcode(false);
            setBarcode(code);
          }}
        />
      )}

      {cameraOpen && (
        <CameraSheet
          title="Scan nutrition label"
          hint="Fill the frame with the nutrition table, straight on."
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            ocr.mutate(file);
          }}
          onPickFile={() => fileRef.current?.click()}
        />
      )}
    </>
  );
}
