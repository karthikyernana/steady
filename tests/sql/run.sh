#!/usr/bin/env bash
# Applies the Supabase migrations to a throwaway local Postgres database and runs the assertions.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=steady_test_$$
PSQL="sudo -u postgres psql -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database $DB" >/dev/null
trap '$PSQL -c "drop database if exists $DB" >/dev/null' EXIT
$PSQL -d $DB < tests/sql/00_supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do $PSQL -d $DB < "$f" 2>&1 | grep -E "ERROR|cron" || true; done
out=$($PSQL -d $DB < tests/sql/10_tests.sql 2>&1 || true)
echo "$out" | sed -n 's/.*NOTICE:  //p; s/.*ERROR:  /ERROR: /p'
echo "$out" | grep -q 'ERROR' && exit 1 || exit 0
