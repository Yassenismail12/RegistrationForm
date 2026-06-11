// Next.js configuration for Cloudflare Pages static export
const { withCloudflare } = require('@cloudflare/next-on-pages');

module.exports = withCloudflare({
  output: 'export',
  trailingSlash: true,
});
