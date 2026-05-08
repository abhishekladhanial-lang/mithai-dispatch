FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY data/products.json ./data/products.json

RUN mkdir -p /var/lib/mithai-dispatch/data /var/backups/mithai-dispatch \
  && addgroup -S app \
  && adduser -S app -G app \
  && chown -R app:app /app /var/lib/mithai-dispatch /var/backups/mithai-dispatch

USER app
EXPOSE 8767
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8767/api/health || exit 1

CMD ["node", "server.js"]
