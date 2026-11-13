import Harness from "./Harness";

// Dev-only preview of the Patterns page with seeded sample data (lib/patternsSample.ts). Never
// real user data. The .dev.tsx name makes it a route only under `next dev` (see next.config.js).
export default function Page() {
  return <Harness />;
}
