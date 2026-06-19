FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY .env.example ./.env.example

ENV PORT=28736
ENV FIFA_API_BASE=https://api.fifa.com/api/v3
ENV WC_COMPETITION_ID=17
ENV WC_SEASON_ID=285023
ENV WC_STAGE_ID=289273
ENV POLL_LIVE_MS=15000
ENV POLL_IDLE_MS=300000
ENV SNAPSHOT_PATH=/data/snapshot.json

EXPOSE 28736

CMD ["npm", "start"]
