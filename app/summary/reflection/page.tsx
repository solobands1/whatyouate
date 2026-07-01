import { Suspense } from "react";
import ReflectionScreen from "../../../components/ReflectionScreen";

export const dynamic = 'force-static';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <ReflectionScreen />
    </Suspense>
  );
}
