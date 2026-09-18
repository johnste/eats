import { spawn } from 'node:child_process';
import sharp from 'sharp';

/**
 * The impure edge of the OCR feature: everything that touches an image or
 * shells out lives here, so parse.ts stays a pure function over text.
 */

export class OcrUnavailableError extends Error {}
export class OcrFailedError extends Error {}

/**
 * Tesseract wants roughly 300 DPI. Below about 40px of glyph height it starts
 * merging a value's unit into the number -- "6,2 g" comes back as "6,29", and
 * "11 g" as "119", which is a plausible-looking wrong answer rather than an
 * obvious failure. Upscaling small images fixes that outright.
 *
 * The ceiling exists only to bound recognition time, and is deliberately high:
 * downscaling a phone photo too far recreates exactly the problem above, since
 * the label is usually only part of the frame.
 */
const MIN_WIDTH = 1400;
const MAX_WIDTH = 2600;
const TIMEOUT_MS = 25_000;

/**
 * Greyscale, normalised contrast, mild sharpening. Nutrition tables are
 * high-contrast black-on-white to begin with; the work here is mostly undoing
 * phone-camera softness and uneven lighting.
 */
export async function preprocess(image: Buffer): Promise<Buffer> {
  const upright = await sharp(image, { failOn: 'none' })
    .rotate() // honour the EXIF orientation a phone writes
    .toBuffer();
  const { width = 0 } = await sharp(upright).metadata();

  const target =
    width > MAX_WIDTH ? MAX_WIDTH : width > 0 && width < MIN_WIDTH ? MIN_WIDTH : null;

  let pipeline = sharp(upright);
  if (target !== null) pipeline = pipeline.resize({ width: target, kernel: 'lanczos3' });

  return pipeline.greyscale().normalise().sharpen().png().toBuffer();
}

export interface RecognizeOptions {
  /** Both languages are always loaded; there is no language switch in the UI. */
  languages?: string;
  /** 6 = "assume a single uniform block of text", which a label table is. */
  psm?: number;
  binary?: string;
}

export function recognize(
  image: Buffer,
  opts: RecognizeOptions = {},
): Promise<string> {
  const { languages = 'swe+eng', psm = 6, binary = 'tesseract' } = opts;

  return new Promise((resolve, reject) => {
    // "- -" means read the image from stdin and write text to stdout, which
    // avoids putting user photos on disk at all.
    const child = spawn(binary, ['-', '-', '-l', languages, '--psm', String(psm)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new OcrFailedError('Reading the label took too long.'));
    }, TIMEOUT_MS);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    child.on('error', (err: NodeJS.ErrnoException) => {
      fail(
        err.code === 'ENOENT'
          ? new OcrUnavailableError('Tesseract is not installed on the server.')
          : new OcrFailedError(err.message),
      );
    });

    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        // A missing language pack shows up here, and is worth saying plainly.
        const detail = /failed loading language|could not initialise/i.test(stderr)
          ? 'The server is missing the Swedish or English language data.'
          : stderr.trim().split('\n')[0] || `tesseract exited with ${code}`;
        reject(new OcrFailedError(detail));
        return;
      }
      resolve(stdout);
    });

    child.stdin.on('error', () => {
      // Tesseract can exit before the write finishes; 'close' reports the real
      // reason, so this just stops an unhandled EPIPE.
    });
    child.stdin.end(image);
  });
}

/** Preprocess, then recognise. */
export async function imageToText(
  image: Buffer,
  opts: RecognizeOptions = {},
): Promise<string> {
  let prepared: Buffer;
  try {
    prepared = await preprocess(image);
  } catch {
    throw new OcrFailedError("That file doesn't look like an image.");
  }
  return recognize(prepared, opts);
}
