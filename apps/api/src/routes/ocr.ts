import { errorResponse, ocrResponse } from '@eats/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { type AppDeps, requireUser } from '../app.ts';
import { parseNutritionText } from '../lib/ocr/parse.ts';
import {
  imageToText,
  OcrFailedError,
  OcrUnavailableError,
} from '../lib/ocr/tesseract.ts';

/** Phone photos are a few MB; anything much larger is not a label. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export const ocrRoutes: FastifyPluginAsync<AppDeps> = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/ocr',
    {
      schema: {
        response: { 200: ocrResponse, 400: errorResponse, 503: errorResponse },
      },
      // Recognition costs real CPU, so it gets a tighter budget than reads.
      config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
    },
    async (req, reply) => {
      await requireUser(req);

      const file = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES } });
      if (!file) return reply.status(400).send({ error: 'Attach a photo of the label.' });
      if (!file.mimetype.startsWith('image/')) {
        return reply.status(400).send({ error: 'That file is not an image.' });
      }

      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        return reply.status(400).send({ error: 'That photo is too large.' });
      }

      try {
        // The image is never written to disk: it goes straight to Tesseract's
        // stdin and is dropped once the text comes back.
        return parseNutritionText(await imageToText(buffer));
      } catch (err) {
        if (err instanceof OcrUnavailableError) {
          req.log.error({ err }, 'tesseract missing');
          return reply.status(503).send({ error: 'Label scanning is not available.' });
        }
        if (err instanceof OcrFailedError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};
