# Creator program: admin notes

The program's rules live in `creators.sql` (run it in the Supabase SQL editor; it only adds new
tables and functions, and is safe to run again). The creator website is whatyouate.app/creators.

## Setup, once

- **RevenueCat webhook:** RevenueCat > Project settings > Integrations > Webhooks. URL
  `https://whatyouate.vercel.app/api/creators/revenuecat`, Authorization header
  `Bearer <REVENUECAT_WEBHOOK_SECRET>`. Add the same secret to the Vercel env vars.
- **Discord:** reports go to `CREATOR_DISCORD_WEBHOOK_URL` if set, otherwise `DISCORD_WEBHOOK_URL`.
- **Daily job:** `/api/cron/creators` runs at 14:00 UTC (in `vercel.json`).

## Loading free Pro codes

Creators get Apple one-time offer codes: 3 months when they join, a year once 3 people they
referred have paid. Generate a batch in App Store Connect (Subscriptions > the subscription >
Offer Codes), download the file, then in the SQL editor:

```sql
select creator_add_pro_codes('3_months', array['CODE1', 'CODE2']);
select creator_add_pro_codes('1_year', array['CODE3', 'CODE4']);
select creator_backfill_pro_codes(); -- gives codes to anyone who joined while the pool was empty
```

Apple's one-time codes expire after at most 6 months, so load small batches.

## Marking a payout paid

The Discord report on the 1st lists who to pay. After sending each one:

```sql
update creator_payouts set status = 'paid', paid_on = current_date, reference = 'e-Transfer ref or note'
where due_on = '2026-12-01' and creator_id = (select id from creators where code = 'SARAH');
```

To hold a payout instead, set `status = 'withheld'`.

## Removing a creator

```sql
update creators set status = 'removed', left_at = now() where code = 'SARAH';
```

Their codes stop working, and no further payouts are created for them.
