import { notFound } from "next/navigation";
import Harness from "./Harness";

// Dev-only preview of the Patterns page with seeded sample data (lib/patternsSample.ts).
// Never real user data. 404s in any production build.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Harness />;
}
