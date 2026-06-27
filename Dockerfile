FROM mcr.microsoft.com/playwright/node:latest

WORKDIR /app

# Copy package metadata and install dependencies first for better caching
COPY package*.json ./
RUN npm install --production

# Copy application source
COPY . ./

ENV PORT=3001
EXPOSE 3001

CMD ["node", "index.js"]
