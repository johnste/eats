import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { Button, ErrorNote } from './ui.tsx';
import { detectLoop, ScanError, startCamera, stopCamera } from '../lib/scanner.ts';

/**
 * Live barcode scanning. Shared by the add screen, where a code is looked up,
 * and the new-food form, where it is simply attached to the food being typed
 * in -- so a product Open Food Facts has never heard of still gets a barcode
 * and is found by scanning next time.
 */
export function BarcodeScanner({
  onClose,
  onFound,
  hint = 'Hold the barcode inside the frame.',
}: {
  onClose: () => void;
  onFound: (code: string) => void;
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let stopDetecting: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        stream = await startCamera(video);
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        stopDetecting = detectLoop(video, onFound);
      } catch (err) {
        setError(
          err instanceof ScanError ? err.message : "The camera couldn't be started.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stopDetecting?.();
      stopCamera(stream);
    };
  }, [onFound]);

  return (
    <Sheet title="Scan a barcode" onClose={onClose}>
      {error ? (
        <div className="space-y-4">
          <ErrorNote>{error}</ErrorNote>
          <p className="text-faint text-[13px]">
            You can still enter the food by hand.
          </p>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full object-cover"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/70"
            />
          </div>
          <p className="text-faint text-center text-[13px]">{hint}</p>
        </div>
      )}
    </Sheet>
  );
}
