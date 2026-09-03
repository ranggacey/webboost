import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["lighthouse", "puppeteer"],
};

export default nextConfig;
