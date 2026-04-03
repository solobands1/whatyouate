import { Suspense } from "react";
import InsightsScreen from "../../../components/InsightsScreen";

export const dynamic = 'force-static';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <InsightsScreen />
    </Suspense>
  );
}
