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

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
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
      video: { facingMode: { ideal: 'environment' } },
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
