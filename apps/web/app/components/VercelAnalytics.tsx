import { Analytics } from '@vercel/analytics/react';

// We use the framework-agnostic `/react` entrypoint rather than `@vercel/analytics/next`.
// The `/next` <Analytics/> calls useSearchParams() internally, which forces a
// `BAILOUT_TO_CLIENT_SIDE_RENDERING` <template> into the prerendered static shell.
// The `/react` variant detects route changes via the History API (works fine in the
// App Router) and renders with no searchParams dependency, so the static HTML stays
// clean while tracking behaviour is unchanged.
export default function VercelAnalytics() {
  return <Analytics />;
}
