#!/usr/bin/env bash
# Runs every suite in its own process (keeps each well under CI step limits) and collects results.
cd "$(dirname "$0")/.."
rm -f tests/results-*.json
TZ=Asia/Kolkata node --test tests/unit/*.test.mjs > tests/unit-results.txt 2>&1; echo "unit exit $?"
node tests/check-shell.mjs; echo "check exit $?"
SUITES=${SUITES:-"core-mobile-light core-mobile-dark core-small-light core-small-dark core-desktop-light core-desktop-dark screens export offline notif ntfy sync pairlink pwa"}
fail=0
for s in $SUITES ${EXTRA_SUITES}; do
  echo "== $s"; out=$(python3 tests/e2e.py --only "$s" ${E2E_ARGS} 2>&1); echo "$out" | grep -E "^(PASS|FAIL)|passed|issues|axe violation|^   "
  echo "$out" | grep -q "^FAIL" && fail=1
done
echo ALLDONE
exit $fail
