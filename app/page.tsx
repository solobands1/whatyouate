import { Suspense } from "react";
import HomeScreen from "../components/HomeScreen";

export const dynamic = 'force-static';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <HomeScreen />
    </Suspense>
  );
}
