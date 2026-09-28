#!/usr/bin/env bash
# Installs / updates the CRM's WhatsApp service on an always-on Linux server
# (the same box that runs the beipoready.com site is ideal). Idempotent.
#
#   git clone https://github.com/beipoready-art/growthavenues-crm.git ~/growthavenues-crm
#   cd ~/growthavenues-crm && bash whatsapp/deploy-server.sh
#
# Then expose port 3018 over https (see whatsapp/nginx.conf.example) and set
# WHATSAPP_SERVICE_URL + WHATSAPP_SERVICE_TOKEN on the CRM (Vercel → Settings → Environment Variables).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo "Node 20+ is required (found: $(node -v 2>/dev/null || echo none)). Install it, e.g. https://github.com/nodesource/distributions" >&2
  exit 1
fi
command -v pm2 >/dev/null || npm install -g pm2

git pull --ff-only 2>/dev/null || true
# Runtime deps only; the service needs Baileys, pino and their dependencies.
npm ci --omit=dev --ignore-scripts

touch .env
if ! grep -q '^WHATSAPP_SERVICE_TOKEN=' .env; then
  printf 'WHATSAPP_SERVICE_TOKEN="%s"\n' "$(openssl rand -hex 24)" >> .env
fi
grep -q '^WHATSAPP_SERVICE_PORT=' .env || printf 'WHATSAPP_SERVICE_PORT="3018"\n' >> .env

pm2 startOrRestart whatsapp/ecosystem.config.cjs --update-env
pm2 save
pm2 startup 2>/dev/null | grep -E '^sudo ' || true

echo
echo "WhatsApp service is running (pm2: beipoready-crm-whatsapp, port $(grep '^WHATSAPP_SERVICE_PORT=' .env | cut -d'"' -f2))."
echo "Token for the CRM's WHATSAPP_SERVICE_TOKEN:"
grep '^WHATSAPP_SERVICE_TOKEN=' .env | cut -d'"' -f2
echo
echo "Health: curl -s http://127.0.0.1:3018/health"
echo "If 'pm2 startup' printed a sudo command above, run it once so the service comes back after a reboot."
