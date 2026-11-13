-- Account deletion: the in-app Delete Account (auth.admin.deleteUser) was refused for anyone with a profile or meal,
-- because these six tables pointed at auth.users with ON DELETE NO ACTION. They now clear along with the account,
-- like workouts, feel_logs, push_tokens and user_subscription_status already did. Each constraint is checked to be
-- exactly "FOREIGN KEY (user_id) REFERENCES auth.users(id)" before it is swapped, so nothing unexpected is touched.
DO $$
DECLARE t text; c text; def text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','meals','nudges','weight_logs','step_logs','sleep_logs'] LOOP
    c := t || '_user_id_fkey';
    SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
      WHERE conname = c AND conrelid = format('public.%I', t)::regclass;
    IF def IS NULL THEN RAISE EXCEPTION 'constraint % not found', c; END IF;
    IF def <> 'FOREIGN KEY (user_id) REFERENCES auth.users(id)' THEN RAISE EXCEPTION 'constraint % is not the expected one: %', c, def; END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I, ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE', t, c, c);
    RAISE NOTICE '% now cascades', c;
  END LOOP;
END $$;

-- Check: nothing outside the auth schema still blocks deleting a user.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
    WHERE contype = 'f' AND confrelid = 'auth.users'::regclass AND connamespace <> 'auth'::regnamespace
      AND confdeltype IN ('a', 'r');
  IF n > 0 THEN RAISE EXCEPTION '% foreign keys still block deleting a user', n; END IF;
  RAISE NOTICE 'account deletion unblocked';
END $$;
