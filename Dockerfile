# The WhatsApp service (whatsapp/server.mjs) for hosts that prefer containers
# over pm2. It only needs Node and the Baileys dependency; mount a volume at
# /app/whatsapp/session so the linked session survives restarts.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts
COPY whatsapp ./whatsapp
ENV WHATSAPP_SERVICE_HOST=0.0.0.0
ENV WHATSAPP_SERVICE_PORT=3018
VOLUME ["/app/whatsapp/session"]
EXPOSE 3018
CMD ["node", "whatsapp/server.mjs"]
