#!/usr/bin/env bash
# One-click start: installs deps and builds on first run, then launches Pixel Studio and opens the browser.
set -e
cd "$(dirname "$(readlink -f "$0")")"
PORT="${PORT:-5178}"
URL="http://127.0.0.1:$PORT"

if ! command -v node >/dev/null; then echo "Node.js >= 20 gerekli."; read -rp "Enter'a bas..."; exit 1; fi

# Already running? Just open the browser.
if curl -fs -o /dev/null "$URL" 2>/dev/null; then
  echo "Pixel Studio zaten çalışıyor: $URL"
  xdg-open "$URL" >/dev/null 2>&1 || true
  exit 0
fi

[ -d node_modules ] || { echo "İlk çalıştırma: bağımlılıklar kuruluyor…"; npm install; }
# Rebuild when sources are newer than the build output
if [ ! -f server/dist/index.js ] || [ ! -f web/dist/index.html ] \
   || [ -n "$(find server/src web/src -newer server/dist/index.js -type f 2>/dev/null | head -1)" ]; then
  echo "Derleniyor…"; npm run build
fi

exec node bin/pixel-studio.js
