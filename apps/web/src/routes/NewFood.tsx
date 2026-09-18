import { atwaterAgrees, toDateKey, type OcrResponse } from '@eats/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Card, ErrorNote, Field } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';

type FieldName = 'kcal100g' | 'protein100g' | 'carbs100g' | 'fat100g';

const NUMERIC: { name: FieldName; label: string; suffix: string }[] = [
  { name: 'kcal100g', label: 'Calories', suffix: 'kcal' },
  { name: 'protein100g', label: 'Protein', suffix: 'g' },
  { name: 'carbs100g', label: 'Carbs', suffix: 'g' },
  { name: 'fat100g', label: 'Fat', suffix: 'g' },
];

/** Anything the parser wasn't sure about gets flagged for a human look. */
const UNCERTAIN = 0.8;

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
          capture="environment"
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
          onClick={() => fileRef.current?.click()}
        >
          {ocr.isPending ? 'Reading the label…' : 'Scan nutrition label'}
        </Button>

        {ocr.error instanceof ApiError && (
          <p className="mt-3">
            <ErrorNote>{ocr.error.message}</ErrorNote>
          </p>
        )}

        {scan && (
          <p className="text-faint mt-3 text-[13px]">
            {flagged.size === 0
              ? 'Read cleanly. Check it against the packet before saving.'
              : `Check the highlighted ${flagged.size === 1 ? 'value' : 'values'} — the scan wasn't sure.`}
          </p>
        )}
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
        <Field
          label="Brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Optional"
        />

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
