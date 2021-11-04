ARG NODE_IMAGE=node:12-alpine

FROM $NODE_IMAGE AS deps
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM $NODE_IMAGE AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules
ENV NEXT_TELEMETRY_DISABLED 1

# Temporary until Next.js swc updates for arm
RUN echo '{"presets":["next/babel"]}' > .babelrc

RUN yarn build
RUN yarn install --production --ignore-scripts --prefer-offline

FROM $NODE_IMAGE AS runner
WORKDIR /app

ENV NODE_ENV production
ENV STORE_PATH /data/store.json
ENV FORCE_COLOR 1

COPY --from=builder /app/next.config.js ./
# COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/entrypoint.sh ./

EXPOSE 3000

CMD ["./entrypoint.sh"]