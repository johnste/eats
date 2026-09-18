/**
 * Barcode scanning via the native BarcodeDetector where it exists, and a
 * WASM ponyfill where it doesn't -- which notably includes Safari on iOS.
 *
 * Camera access needs a secure context. Coolify terminates TLS so production
 * is fine; in development only localhost counts as secure, so scanning from a
 * phone pointed at a dev server over the LAN will not work.
 */

export type ScanFailure =
  | 'insecure-context'
  | 'permission-denied'
  | 'no-camera'
  | 'unsupported';

export class ScanError extends Error {
  readonly reason: ScanFailure;

  constructor(reason: ScanFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] as const;

export interface CameraOptions {
  /**
   * Reading a nutrition table needs far more detail than reading a barcode:
   * Tesseract starts merging a value's unit into its number once glyphs fall
   * below roughly 40px, so the label camera asks for as much resolution as the
   * device will give.
   */
  highResolution?: boolean;
}

export async function startCamera(
  video: HTMLVideoElement,
  opts: CameraOptions = {},
): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new ScanError(
      'insecure-context',
      'Scanning needs a secure (https) connection.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new ScanError('unsupported', "This browser can't use the camera.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // The rear camera is the one pointed at the packet.
      video: {
        facingMode: { ideal: 'environment' },
        ...(opts.highResolution
          ? { width: { ideal: 2560 }, height: { ideal: 1440 } }
          : {}),
      },
      audio: false,
    });
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new ScanError(
        'permission-denied',
        'Camera access was blocked. Allow it in your browser settings to scan.',
      );
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new ScanError('no-camera', 'No camera found on this device.');
    }
    throw new ScanError('unsupported', "The camera couldn't be started.");
  }

  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * Poll the video for a barcode. Returns a stop function; the callback fires
 * once and detection halts, so a single packet can't enqueue ten lookups.
 */
export function detectLoop(
  video: HTMLVideoElement,
  onFound: (barcode: string) => void,
): () => void {
  let active = true;
  let timer: number | undefined;
  // The ponyfill carries a WebAssembly build of ZXing. Importing it here, at
  // the moment the camera opens, keeps it out of every other screen's payload.
  const detector = import('barcode-detector/ponyfill').then(
    (m) => new m.BarcodeDetector({ formats: [...FORMATS] }),
  );

  const tick = async () => {
    if (!active) return;
    try {
      if (video.readyState >= 2) {
        const [hit] = await (await detector).detect(video);
        if (hit?.rawValue && active) {
          active = false;
          onFound(hit.rawValue);
          return;
        }
      }
    } catch {
      // A single failed frame is normal while focusing; keep going.
    }
    timer = window.setTimeout(() => void tick(), 250);
  };

  void tick();
  return () => {
    active = false;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/**
 * Grab the current frame as a JPEG file, at the camera's native resolution
 * rather than the size it happens to be displayed at -- the preview is a few
 * hundred pixels wide and OCR on that would be hopeless.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  filename = 'label.jpg',
): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new ScanError('unsupported', 'The camera has not started yet.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ScanError('unsupported', "This browser can't capture a photo.");
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    // Quality 0.92: JPEG artefacts around small text cost more accuracy than
    // the bytes are worth saving.
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
  );
  if (!blob) throw new ScanError('unsupported', "The photo couldn't be captured.");

  return new File([blob], filename, { type: 'image/jpeg' });
}
