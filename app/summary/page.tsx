import { Suspense } from "react";
import SummaryScreen from "../../components/SummaryScreen";

export const dynamic = 'force-static';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <SummaryScreen />
    </Suspense>
  );
}
