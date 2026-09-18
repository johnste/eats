import { atwaterAgrees, toDateKey, type OcrResponse } from '@eats/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
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
  const navigate = useNavigate();
  const date = params.get('date') ?? toDateKey();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(params.get('name') ?? '');
  const [brand, setBrand] = useState(params.get('brand') ?? '');
  const [barcode] = useState(params.get('barcode') ?? '');
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

  const ocr = useMutation({
    mutationFn: api.scanLabel,
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
    mutationFn: () =>
      api.createFood({
        name: name.trim(),
        brand: brand.trim() || null,
        barcode: barcode || null,
        kcal100g: parsed.kcal100g,
        protein100g: parsed.protein100g,
        carbs100g: parsed.carbs100g,
        fat100g: parsed.fat100g,
        ...(scan?.servingG.value
          ? { servings: [{ label: '1 portion', grams: scan.servingG.value }] }
          : {}),
      }),
    onSuccess: () => navigate(`/add?date=${date}`),
  });

  return (
    <>
      <h1 className="text-ink mb-1 text-lg font-semibold">New food</h1>
      <p className="text-muted mb-4 text-[13px]">
        Values are per 100 g, the way labels state them.
      </p>

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
            These macros don't add up to the calories. That usually means one
            number was misread — worth a second look, but you can save anyway.
          </p>
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

      {barcode && (
          <p className="text-faint nums text-xs">Barcode {barcode} will be attached.</p>
        )}

        {save.error instanceof ApiError && <ErrorNote>{save.error.message}</ErrorNote>}

        <Button type="submit" className="w-full" disabled={!complete || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save food'}
        </Button>
      </form>
    </>
  );
}
