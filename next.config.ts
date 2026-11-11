import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module: load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["better-sqlite3"],
  // Reviewers run `npm run dev`: the floating dev badge covered the demo button (desktop) and Send (phone).
  devIndicators: false,
};

export default nextConfig;
