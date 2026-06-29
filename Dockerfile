FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

RUN npx playwright install webkit --with-deps

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
