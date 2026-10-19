"""WCAG contrast check for every style x theme token set in css/app.css + css/styles.css."""
import re, sys, os
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
css = open(os.path.join(ROOT, 'css/app.css')).read() + open(os.path.join(ROOT, 'css/styles.css')).read()
def block(sel):
    m = re.search(re.escape(sel) + r'\s*\{([^}]*)\}', css); return dict(re.findall(r'--([\w-]+):\s*(#[0-9A-Fa-f]{6})', m.group(1))) if m else {}
base_l, base_d = block(':root'), block('[data-theme="dark"]')
def tokens(style, dark):
    t = dict(base_l); 
    if dark: t.update(base_d)
    if style not in ('liquid', 'paper'):
        t.update(block(f'html[data-style="{style}"]'))
        if dark: t.update(block(f'html[data-style="{style}"][data-theme="dark"]'))
    return t
def rgb(h): return [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
def lum(h): return sum(w * (c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4) for w, c in zip((.2126, .7152, .0722), rgb(h)))
def cr(a, b): la, lb = sorted([lum(a), lum(b)], reverse=True); return (la + .05) / (lb + .05)
def mix(a, b, p):  # p of a over b
    return '#' + ''.join(f'{round((x * p + y * (1 - p)) * 255):02x}' for x, y in zip(rgb(a), rgb(b)))
bad = 0
for style in sys.argv[1:] or ['liquid', 'grid', 'papercut', 'midnight']:
    for dark in (False, True):
        t = tokens(style, dark); rows = []
        pairs = [(f, b) for f in ('ink', 'ink-2', 'muted', 'faint') for b in ('ground', 'surface', 'surface-2')]
        pairs += [('accent', 'ground'), ('accent', 'surface'), ('accent', 'accent-soft'), ('accent-ink', 'accent'), ('ground', 'ink'),
                  ('hi', 'surface'), ('danger', 'surface'), ('danger', 'surface-2'), ('muted', 'accent-soft'), ('ink', 'accent-soft')]
        for f, b in pairs: rows.append((f'{f} on {b}', cr(t[f], t[b])))
        rows.append(('hi on prio chip', cr(t['hi'], mix(t['hi'], t['surface'], .14))))
        rows.append(('accent on accent-soft chip', cr(t['accent'], t['accent-soft'])))
        rows.append(('btn.danger text', cr(t['ground'] if dark else '#ffffff', t['danger'])))
        rows.append(('ground on ink (toast/primary)', cr(t['ground'], t['ink'])))
        fails = [(n, v) for n, v in rows if v < 4.5]
        bad += len(fails) if style != 'liquid' else 0
        print(f"{style:9} {'dark ' if dark else 'light'} min {min(v for _, v in rows):.2f}  " + ('OK' if not fails else 'FAIL: ' + ', '.join(f'{n}={v:.2f}' for n, v in fails)))
sys.exit(1 if bad else 0)
