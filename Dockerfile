FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Install WebKit browser binaries
RUN npx playwright install webkit

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
