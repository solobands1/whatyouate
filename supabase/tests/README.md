Local tests for creators.sql against a plain Postgres with a small Supabase stand-in.

    initdb -D /tmp/pg -U postgres -A trust
    pg_ctl -D /tmp/pg -o "-p 54329 -k '' -c listen_addresses=127.0.0.1" start
    export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres
    psql -c "create database t"
    psql -d t -f setup.sql && psql -d t -f ../creators.sql && psql -d t -f tests.sql

The last line should print ALL TESTS PASSED.

House account (creators_house.sql): after the line above,

    psql -d t -f ../creators_house.sql && psql -d t -f house_tests.sql

should print HOUSE TESTS PASSED. Two statement tests in tests.sql fail when run on the 1st of a month
(the statement period collapses); that's a test date issue, not the SQL.

App usage (owner_usage.sql) has its own stand-in with the app tables it reads. In a fresh database:

    psql -c "create database u"
    psql -d u -f usage_setup.sql && psql -d u -f ../creators.sql && psql -d u -f ../owner_usage.sql && psql -d u -f usage_tests.sql

should print USAGE TESTS PASSED.
