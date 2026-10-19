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

Creators get Apple one-time offer codes on the normal monthly plan, set not to auto-renew: 3 months
when they join ("Creator Pro 3 months"), a year once 3 people they referred have paid ("Creator Pro
1 year"). Both offers are under Subscriptions > WhatYouAte Monthly > View all Subscription Pricing >
Offer Codes. For a new batch, open the offer, Create One-Time Use Codes (500 is the minimum, pick
the latest expiry), download the file, then in the SQL editor:

```sql
select creator_add_pro_codes('3_months', array['CODE1', 'CODE2'], '2027-04-19');
select creator_add_pro_codes('1_year', array['CODE3', 'CODE4'], '2027-04-19');
select creator_backfill_pro_codes(); -- gives codes to anyone who joined while the pool was empty
```

The third argument is the batch's expiry date. Codes with under two weeks left are never handed
out, and the daily report warns when the supply is low or close to expiring.

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
