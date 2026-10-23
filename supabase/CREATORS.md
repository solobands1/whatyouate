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

Payouts are worked out on the 1st (the Discord report lists who to pay) and sent during the first
week. After sending each one, open https://whatyouate.app/creators/owner (log in with an owner email),
set its status to Paid and add the e-Transfer or Wise reference. That freezes the creator's statement
for that payout and emails it to them. On the 5th, Discord lists anything still unsent.

Owners are the login emails in `creator_owners`:

```sql
insert into creator_owners (email) values ('you@example.com');
```

To hold a payout, set it to Withheld on the owner page. A paid payout can't be changed there; if one
was marked by mistake, fix it in SQL (`update creator_payouts set status = 'due', paid_on = null,
paid_at = null, statement = null where id = '...'`), knowing the creator has already had the email.

## Removing a creator

```sql
update creators set status = 'removed', left_at = now() where code = 'SARAH';
```

Their codes stop working, and no further payouts are created for them.
