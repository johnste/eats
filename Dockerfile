# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build ---
# Only the SPA is compiled. Node strips TypeScript types natively, so the API
# runs its source directly and needs no build step at all.
FROM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @eats/web

# Re-resolve with dev dependencies dropped, for copying into the runtime image.
RUN npm ci --omit=dev

# -------------------------------------------------------------- runtime ---
FROM node:26-alpine AS runtime
WORKDIR /app

# The only non-Node part of the image. English ships in the base tesseract
# package; Swedish is separate.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-swe

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist

# node:alpine ships an unprivileged "node" user; nothing here needs root.
USER node

EXPOSE 3000

# Coolify polls this; it also proves the process reached the listen call.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run on boot, so a deploy carrying a schema change applies it
# without a separate release step.
CMD ["node", "apps/api/src/index.ts"]
