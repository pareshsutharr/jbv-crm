import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // KYC uploads are posted as multipart form data to API routes.
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // The WhatsApp Web client (Baileys) is used only by the separate service in
  // whatsapp/server.mjs; keep it and its native bits out of serverless bundles.
  serverExternalPackages: ["qrcode"],
  outputFileTracingExcludes: {
    "*": ["node_modules/@whiskeysockets/baileys/**", "node_modules/whatsapp-rust-bridge/**", "node_modules/libsignal/**", "node_modules/music-metadata/**", "node_modules/protobufjs/**"],
  },
};

export default nextConfig;
