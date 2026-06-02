import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only modules must not be bundled by the server compiler.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist"],
};

export default nextConfig;
