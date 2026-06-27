# Puchuku Backend

Express.js backend server for Puchuku streaming app. Handles video stream proxying and HLS URL extraction from vidlink.pro.

## Quick Start

```bash
# Install dependencies
cd backend
npm install

# Run in development
npm run dev

# Build frontend and run in production
cd ..
npm run build
cd backend
NODE_ENV=production npm start
```

## API Endpoints

- `GET /api/proxy?url=<encoded_url>` - Proxy HLS/video requests
- `GET /api/stream?type=movie|tv&id=<tmdb_id>&season=<n>&episode=<n>` - Extract stream URL

## Production Deployment (VPS)

### Oracle Linux / Rocky Linux / AlmaLinux / RHEL

```bash
# Enable EPEL and PowerTools
dnf install -y epel-release
dnf config-manager --set-enabled powertools

# Install Chrome dependencies
dnf install -y google-chrome-stable wget

# If Chrome doesn't work, install these additional packages:
dnf install -y --setopt=install_weak_deps=False \
  cups-libs \
  libXrandr \
  libXcomposite \
  libXdamage \
  libXfixes \
  libXkbcommon \
  libgbm \
  atk \
  atk-bridge \
  cups \
  at-spi2-atk \
  xorg-x11-server-utils
```

### Ubuntu / Debian

```bash
apt-get update
apt-get install -y wget gnupg ca-certificates
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get update
apt-get install -y google-chrome-stable libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libatk1.0-0 libatk-bridge2.0-0
```

### Upload and run

```bash
# Upload to VPS
scp -r ./backend user@your-vps:/var/www/puchuku/

# Install npm dependencies
cd /var/www/puchuku/backend
npm install --production

# Build frontend
cd /var/www/puchuku
npm run build

# Run with PM2
pm2 start backend/index.js --name puchuku
pm2 save
```

## Nginx Configuration

```nginx
server {
    listen 80;
    server_name puchuku.anish-karki.com.np;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

## Note

This backend only handles the video streaming proxy. For user authentication (login/register/profiles/my-list), you need the PHP API in the `/api` folder with a MySQL database.