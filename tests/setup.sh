#!/usr/bin/env bash
# One-time test tooling: Playwright (Chromium), axe-core, Lighthouse. Re-run after a fresh machine.
set -e
pip install -q "playwright==1.49.1"
python3 -m playwright install chromium
(sudo -n true 2>/dev/null && sudo apt-get install -y -q libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-liberation >/dev/null) || python3 -m playwright install-deps chromium || true
mkdir -p /tmp/axe && (cd /tmp/axe && npm pack axe-core@4 >/dev/null 2>&1 && tar xzf axe-core-*.tgz)
mkdir -p /tmp/lh && (cd /tmp/lh && npm i --silent lighthouse@12 >/dev/null 2>&1) || echo "lighthouse optional: install failed"
echo "tooling ready"
