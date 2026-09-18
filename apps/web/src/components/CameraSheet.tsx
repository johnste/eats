import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { Button, ErrorNote } from './ui.tsx';
import { captureFrame, ScanError, startCamera, stopCamera } from '../lib/scanner.ts';

/**
 * A live camera with a shutter button. Used for label photos, where the point
 * is to frame the nutrition table yourself and see what you're capturing --
 * a file input gives you a picker on desktop and inconsistent behaviour on
 * mobile, and no way to tell whether the table is in shot.
 */
export function CameraSheet({
  title,
  hint,
  onCapture,
  onClose,
  onPickFile,
}: {
  title: string;
  hint: string;
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Escape hatch when there's no usable camera. */
  onPickFile?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    void (async () => {
      try {
        const stream = await startCamera(video, { highResolution: true });
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        setReady(true);
      } catch (err) {
        setError(
          err instanceof ScanError ? err.message : "The camera couldn't be started.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const file = await captureFrame(video);
      stopCamera(streamRef.current);
      streamRef.current = null;
      onCapture(file);
    } catch (err) {
      setError(err instanceof ScanError ? err.message : "Couldn't take the photo.");
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      {error ? (
        <div className="space-y-4">
          <ErrorNote>{error}</ErrorNote>
          {onPickFile && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                onClose();
                onPickFile();
              }}
            >
              Choose a photo instead
            </Button>
          )}
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
              className="aspect-[3/4] w-full object-cover"
            />
            {/* A guide rather than a crop: the whole frame is sent, but the
                table should sit roughly inside it and fill the width. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-5 top-1/2 h-48 -translate-y-1/2 rounded-lg border-2 border-white/70"
            />
          </div>

          <p className="text-faint text-center text-[13px]">{hint}</p>

          <Button className="w-full" disabled={!ready || busy} onClick={() => void shoot()}>
            {busy ? 'Reading the label…' : ready ? 'Take photo' : 'Starting camera…'}
          </Button>

          {onPickFile && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onPickFile();
              }}
              className="text-muted w-full text-center text-[13px] underline underline-offset-4"
            >
              Choose an existing photo
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
