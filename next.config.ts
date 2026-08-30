import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "sharp"],
  outputFileTracingIncludes: {
    // sharp's actual native addon (a .node file loaded via dlopen, not a static
    // require()) lives in a platform-specific @img/sharp-* package, same category
    // of problem as pdfjs-dist's worker file below — Vercel's automatic tracer
    // doesn't follow a dynamic native-module load, so it has to be listed
    // explicitly or the deployed function silently ships without it.
    "/api/documents/**": [
      "./node_modules/pdfjs-dist/legacy/build/*.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/sharp/**",
      "./node_modules/@img/sharp-linux-x64/**",
      "./node_modules/@img/sharp-libvips-linux-x64/**",
    ],
  },
};

export default nextConfig;
