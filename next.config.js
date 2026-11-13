const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

/** @type {(phase: string) => import('next').NextConfig} */
module.exports = (phase) => ({
  // Files named page.dev.tsx (the Patterns preview harness in app/dev/) are routes only under
  // `next dev`. Every other phase, including `next build` for Vercel and Cloudflare, never sees
  // them, so the harness can't ship.
  pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? ["dev.tsx", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
});
