FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx tsc -p tsconfig.json

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# onnxruntime-node needs libstdc++/libgomp; curl is used by the healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The model is NOT baked in — it downloads into the model-cache volume on first boot.
RUN mkdir -p /models && chown node:node /models
USER node
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
