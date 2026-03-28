import { Suspense } from "react";
import CaptureScreen from "../../components/CaptureScreen";

export const dynamic = 'force-static';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <CaptureScreen />
    </Suspense>
  );
}
