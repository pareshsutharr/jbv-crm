// pm2 config for the WhatsApp service: `pm2 start whatsapp/ecosystem.config.cjs && pm2 save`
const path = require("node:path");
module.exports = {
  apps: [
    {
      name: "beipoready-crm-whatsapp",
      script: "whatsapp/server.mjs",
      cwd: path.resolve(__dirname, ".."),
      autorestart: true,
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" }, // WHATSAPP_SERVICE_TOKEN etc. are read from .env
    },
  ],
};
