import { Suspense } from "react";
import ProfileScreen from "../../components/ProfileScreen";

export const dynamic = 'force-static';

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <ProfileScreen />
    </Suspense>
  );
}
