FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libgstreamer1.0-0 \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-gl \
    libgtk-4-1 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libharfbuzz0b \
    libharfbuzz-icu0 \
    libcairo-gobject2 \
    libcairo2 \
    libgraphene-1.0-0 \
    libatomic1 \
    libsqlite3-0 \
    liblcms2-2 \
    libepoxy0 \
    libfreetype6 \
    libfontconfig1 \
    libwebpmux3 \
    libwebp7 \
    libwebpdemux2 \
    libwayland-egl1 \
    libpsl5 \
    libnghttp2-14 \
    libavif15 \
    libwoff1 \
    libopus0 \
    libenchant-2-2 \
    libgudev-1.0-0 \
    libsecret-1-0 \
    libhyphen0 \
    libgdk-pixbuf2.0-0 \
    libegl1 \
    libnotify4 \
    libxslt1.1 \
    libevent-2.1-7 \
    libgles2 \
    libvpx7 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

RUN npx playwright install webkit --with-deps

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
