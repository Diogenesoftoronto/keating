import sys
def sub(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, (path, a[:80])
        s = s.replace(a, b, 1)
    open(path, 'w').write(s)

sub('shared.css', [
 (".gs{display:block;width:72px;height:72px;background-image:var(--gimg);background-size:576px calc(var(--gn) * 72px);background-position:calc(var(--f,0) * -72px) calc(var(--r) * -72px)}",
  ".gs{display:block;width:60px;height:60px;background-image:var(--gimg);background-size:480px calc(var(--gn) * 60px);background-position:calc(var(--f,0) * -60px) calc(var(--r) * -60px)}"),
 (".kg{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px 9px;border:1px solid var(--line);border-radius:4px;background:var(--card);text-align:center}",
  ".kg{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px 9px;border:1px solid var(--line);border-radius:4px;background:#f6f2e8;color:#1c211b;text-align:center}"),
 (".kg b{font-family:var(--mono);font-size:10.5px;font-weight:600}.kg small{font-size:10px;line-height:1.3;color:var(--ink-faint)}",
  ".kg b{font-family:var(--mono);font-size:10.5px;font-weight:600}.kg small{font-size:10px;line-height:1.3;color:#6c7468}"),
])

p = 'bots-page.mjs'; s = open(p).read()
i = s.index('<section class="board">\n  <div class="board-h"><span class="n">K3</span>')
j = s.index('</section>\n</div>`;\n}', i)
k3 = s[i:j + len('</section>')]
s = s[:i] + s[j + len('</section>\n'):]
s = s.replace("${meta.gallery.length} animations, ${meta.gallery.length - 10} of them new. Open full screen to play.", "The full set of animations is on the next page. Open full screen to play.")
helpers = '''  const have = new Set(meta.gallery);
  const tile = (n) => `<div class="kg"><i class="gs" style="--r:${meta.gallery.indexOf(n)}"></i><b>${n}</b><small>${NOTES[n] ?? ""}</small></div>`;
  const grouped = new Set(GROUPS.flatMap(([, l]) => l));
  const extra = meta.gallery.filter((n) => !grouped.has(n));
  const groups = GROUPS.map(([t, l]) => [t, l.filter((n) => have.has(n))]).concat(extra.length ? [["More", extra]] : []);
  const gallery = groups.map(([t, l]) => `<div class="ggrp"><span class="eb mu">${t} · ${l.length}</span><div class="kgrid">${l.map(tile).join("")}</div></div>`).join("");
'''
assert helpers in s
s = s.replace(helpers, '', 1)
s += '''
export function botsGalleryBody(I, meta) {
''' + helpers + '''  return `<div class="wrap">
<p class="lede"><b>Keating's animations.</b> ${meta.gallery.length} in all, ${meta.gallery.length - 10} of them new, each with the event that triggers it.</p>
<div class="controls"><label>Motion <span class="tog" data-tog="motion"><button data-v="full" aria-pressed="true">Full</button><button data-v="reduced" aria-pressed="false">Reduced</button></span></label></div>
''' + k3 + '''
</div>`;
}
'''
open(p, 'w').write(s)

sub('build.mjs', [
 ('import { botsBody } from "./bots-page.mjs";', 'import { botsBody, botsGalleryBody } from "./bots-page.mjs";'),
 ('const LEAN = new Set(["bots"]);\nconst TEXTURES = { bots: [], glyphs:', 'const LEAN = { bots: "play", "bots-gallery": "gallery" };\nconst TEXTURES = { glyphs:'),
 ('["bots", "Keating companion", botsBody(I, botsMeta)]];', '["bots", "Keating companion", botsBody(I, botsMeta)], ["bots-gallery", "Keating animations", botsGalleryBody(I, botsMeta)]];'),
 ('${LEAN.has(name) ? `<script>window.KBOTS={play:"${asset("bots-play.webp")}",gallery:"${asset("bots-gallery.webp")}",meta:${JSON.stringify(botsMeta)}};</script>',
  '${LEAN[name] ? `<script>window.KBOTS={${LEAN[name]}:"${asset(`bots-${LEAN[name]}.webp`)}",meta:${JSON.stringify(botsMeta)}};</script>'),
 ('<script>/* Motion 14.14.0 (motion.dev), MIT licence. Tree-shaken build of animate, hover, press, inView, stagger. */\n${motion}</script>',
  '${LEAN[name] ? "" : `<script>/* Motion 14.14.0 (motion.dev), MIT licence. Tree-shaken build of animate, hover, press, inView, stagger. */\n${motion}</script>`}'),
])
print('ok')
