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

  // Suppress Turbopack workspace root warning
  turbopack: {
    root: __dirname,
  },

  // Opt out of Next.js telemetry
  env: {
    NEXT_TELEMETRY_DISABLED: '1',
  },
};

module.exports = nextConfig;  