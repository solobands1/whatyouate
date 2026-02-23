import { Suspense } from "react";
import ProfileScreen from "../../components/ProfileScreen";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <ProfileScreen />
    </Suspense>
  );
}
