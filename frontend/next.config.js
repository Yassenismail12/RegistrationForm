/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Cloudflare Pages: static HTML export
  output: 'export',

  // Disable image optimization (not supported in static export)
  images: {
    unoptimized: true,
  },

  // Trailing slash ensures correct routing on Cloudflare Pages
  trailingSlash: true,

  // Optional: set the export output directory (matches wrangler.toml)
  distDir: 'out',

  // Suppress build errors from ESLint/TypeScript during CI
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;
