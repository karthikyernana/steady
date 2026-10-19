() => {
      const issues = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
      const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('.hidden,[hidden],details:not([open]) > :not(summary)'); };
      const sel = 'button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, summary, label.switch';
      for (const el of document.querySelectorAll(sel)) {
        if (!vis(el)) continue;
        if (el.matches('.switch input')) continue;
        if (el.closest('p, li, small, .hint') && el.matches('a, .link') && !el.matches('.btn')) continue; // inline text links (WCAG 2.5.8 exception)
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 || r.left < -1) issues.push(`offscreen: ${el.tagName.toLowerCase()} "${(el.textContent||el.getAttribute('aria-label')||el.placeholder||'').trim().slice(0,30)}"`);
        if (Math.round(r.height) < 44 || Math.round(r.width) < 44) issues.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent||el.getAttribute('aria-label')||el.placeholder||'').trim().slice(0,30)}"`);
      }
      for (const el of document.querySelectorAll('h1,h2,h3,p,.t-title,.btn,.chip-btn,.tab span,.sync-chip span')) {
        if (!vis(el)) continue;
        const s = getComputedStyle(el);
        if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) issues.push(`clipped text: ${el.textContent.trim().slice(0,40)}`);
        const r = el.getBoundingClientRect(); if (r.right > vw + 1) issues.push(`text overflows viewport: ${el.textContent.trim().slice(0,40)}`);
      }
      return [...new Set(issues)];
    }