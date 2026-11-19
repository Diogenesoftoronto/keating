import { readFileSync, writeFileSync } from "node:fs";

const references = [
  ["C1", "Chat · Session in progress", "The reply uses a serif reading face. The rail and message actions recede, and the composer has the strongest edge."],
  ["R1", "Review · Session queue", "Rows share a single set of rules. The selected session gets a green edge, and one dark action leads back into the review."],
  ["R2", "Review · Reading workspace", "The outline sits beside the reading column. A pale wash and a narrow green edge identify the current item."],
  ["LP2", "Landing · Opening", "A short paper masthead precedes a monospaced headline, one green action, and an illustrated sequence with its controls underneath."],
];

// C1, R1 and R2 are captures of the saved early boards in the original
// experiments checkout, before their later alignment with the application.
// LP2 comes from the subsequent landing board in this design-pass worktree.
const pairing = {
  download: "LP2", pricing: "C1", blog: "R1", post: "R2",
  paper: "LP2", privacy: "R2", terms: "R2",
};

function imageData(path) {
  return "data:image/avif;base64," + readFileSync(path).toString("base64");
}

export function buildPublicComparison(out, pages) {
  const originals = Object.fromEntries(references.map(([id, label, description]) =>
    [id, { label, description, src: imageData(`assets/earlier-boards/${id}.avif`) }]
  ));
  const current = Object.fromEntries(pages.map(([id, label, , description]) =>
    [id, { label, description, reference: pairing[id], src: imageData(`assets/public-pages/${id}-desktop.avif`) }]
  ));
  const options = Object.entries(current).map(([id, page]) => `<option value="${id}">${page.label}</option>`).join("");
  const referenceOptions = references.map(([id, label]) => `<option value="${id}">${id} · ${label}</option>`).join("");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keating · Earlier mockups and public pages</title><style>
*{box-sizing:border-box}body{margin:0;color:var(--foreground,#20271f);font:14px/1.45 var(--font-sans,system-ui)}
main{max-width:1550px;margin:auto}header{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
label{font-weight:600}select{max-width:100%;display:block;margin-top:3px;border:1px solid var(--border,#b9baad);padding:6px;border-radius:4px;background:var(--card,#fbfaf6);color:inherit;font:inherit}
section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px;align-items:start}
section[data-view="old"],section[data-view="new"]{grid-template-columns:minmax(0,1fr)}
section[data-view="old"] .current,section[data-view="new"] .earlier{display:none}
figure h2{margin:0 0 5px;font:600 13px/1.35 var(--font-sans,system-ui)}
figure{margin:0;min-width:0}figure img{width:100%;height:auto;display:block;border:1px solid var(--border,#b9baad)}
figcaption{margin-top:6px;max-width:70ch;color:var(--muted-foreground,#576050);font-size:13px}
a{color:inherit;text-underline-offset:3px}footer{margin-top:12px}select:focus-visible,a:focus-visible{outline:2px solid var(--ring,#14743c);outline-offset:2px}
@media(max-width:700px){section{grid-template-columns:1fr}header{gap:.6rem}}
@media(min-width:1001px){body{padding:22px}}
@media(prefers-color-scheme:dark){:root{color-scheme:dark}body{color:var(--foreground,#e9e8df)}select{background:var(--card,#17251e)}figcaption{color:var(--muted-foreground,#afb9b0)}}
</style><main>
<header><label>Public page<select id="page">${options}</select></label><label>Earlier mockup<select id="reference">${referenceOptions}</select></label>
<label>View<select id="layout"><option value="both">Compare both</option><option value="old">Earlier mockup only</option><option value="new">Current page only</option></select></label></header>
<section aria-label="Visual comparison"><figure class="earlier"><h2 id="old-title"></h2><img id="old" alt=""><figcaption id="old-caption"></figcaption></figure>
<figure class="current"><h2 id="new-title"></h2><img id="new" alt=""><figcaption id="new-caption"></figcaption></figure></section>
<footer><a id="board" href="public-mockups.html">Open desktop and phone captures</a></footer></main>
<script>
const current=${JSON.stringify(current)},originals=${JSON.stringify(originals)};
const page=document.querySelector('#page'),reference=document.querySelector('#reference');
function display() {
  const a=originals[reference.value],b=current[page.value];
  const old=document.querySelector('#old'),revised=document.querySelector('#new');
  old.src=a.src; old.alt=reference.value+' · '+a.label;
  revised.src=b.src; revised.alt='Current '+b.label+' page';
  document.querySelector('#old-title').textContent=reference.value+' · '+a.label;
  document.querySelector('#new-title').textContent=b.label+' · Current page';
  document.querySelector('#old-caption').textContent=a.description;
  document.querySelector('#new-caption').textContent=b.description;
  document.querySelector('#board').href='public-mockups.html#'+page.value;
}
function pairPage(){reference.value=current[page.value].reference;display()}
const requested=location.hash.slice(1);
page.value=Object.hasOwn(current,requested)?requested:'download';pairPage();
page.addEventListener('change',()=>{pairPage();location.hash=page.value});
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(Object.hasOwn(current,id)&&page.value!==id){page.value=id;pairPage()}});
reference.addEventListener('change',display);
document.querySelector('#layout').addEventListener('change',event=>{document.querySelector('section').dataset.view=event.target.value});
</script></html>`;
  writeFileSync(`${out}/public-comparison.html`, html);
}
