export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-md px-6 pb-20 pt-14">
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted/60 hover:text-ink/60 transition-colors"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12L6 8l4-4" />
          </svg>
          Back
        </a>

        <h1 className="text-2xl font-semibold text-ink">Privacy Policy</h1>
        <p className="mt-1 text-xs text-muted/60">Last updated: April 2025</p>

        <div className="mt-8 space-y-6 text-sm text-ink/70 leading-relaxed">

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">What we collect</h2>
            <p>WhatYouAte collects the information you provide when you create an account (email address, name) and when you use the app (meal photos, food logs, workout logs, and profile details like age, weight, height, and dietary preferences). This data is used solely to power your personalized nutrition insights and nudges.</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">How we use your data</h2>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>To analyze your meals and generate nutrition estimates</li>
              <li>To generate personalized nudges and insights</li>
              <li>To calculate progress toward your health goals</li>
              <li>To improve the app over time (in aggregate, anonymized form only)</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Meal photos</h2>
            <p>Photos you take are sent to our AI analysis service to identify food items and estimate nutrition. Photos are not permanently stored on our servers — they are processed and discarded. Thumbnails may be stored locally on your device for display purposes.</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Third-party services</h2>
            <p>We use the following third-party services:</p>
            <ul className="mt-1.5 space-y-1.5 list-disc list-inside">
              <li><span className="font-medium text-ink/80">Supabase</span> — secure database and authentication</li>
              <li><span className="font-medium text-ink/80">Anthropic (Claude)</span> — AI-powered meal analysis and nudge generation</li>
            </ul>
            <p className="mt-2">These services process your data only as needed to operate the app and are bound by their own privacy policies.</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Data storage and security</h2>
            <p>Your account data is stored securely using Supabase. We use industry-standard encryption in transit and at rest. You can delete your account and all associated data at any time from the Profile screen.</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Your rights</h2>
            <p>You can request access to, correction of, or deletion of your personal data at any time. To delete your account and all data, use the "Delete account" option in your Profile. For any other requests, contact us at the email below.</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Children</h2>
            <p>WhatYouAte is not intended for use by children under 13. We do not knowingly collect data from children under 13.</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Changes to this policy</h2>
            <p>We may update this policy as the app evolves. If we make material changes, we will notify you in the app. Continued use after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Contact</h2>
            <p>Questions? Email us at <a href="mailto:hello@whatyouate.app" className="text-primary underline-offset-2 hover:underline">hello@whatyouate.app</a></p>
          </section>

        </div>
      </div>
    </div>
  );
}
