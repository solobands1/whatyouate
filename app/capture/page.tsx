import { Suspense } from "react";
import CaptureScreen from "../../components/CaptureScreen";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <CaptureScreen />
    </Suspense>
  );
}
