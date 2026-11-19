import { readFileSync, writeFileSync } from "node:fs";

const sections = [
  ["plans", "Plans"],
  ["credits", "Prepaid credits"],
  ["benefits", "Personal benefits"],
  ["questions", "Pricing questions"],
];

export function buildPricingPhoneBoard(out) {
  const captures = Object.fromEntries(sections.map(([id]) => {
    const pair = ["before", "after"].map(revision => {
      const file = revision === "after" && id === "plans"
        ? "assets/public-pages/pricing-phone.avif"
        : `assets/pricing-phone/${revision}-${id}.avif`;
      return "data:image/avif;base64," + readFileSync(file).toString("base64");
    });
    return [id, pair];
  }));
  const options = sections.map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keating · Phone pricing comparison</title>
<style>
  * { box-sizing: border-box }
  body { margin: 0; color: var(--foreground, #242820); font: 14px/1.45 var(--font-sans, system-ui) }
  main { max-width: 820px; margin-inline: auto }
  header { display: flex; align-items: end; flex-wrap: wrap; gap: 10px 16px }
  label, figcaption { font-weight: 600 }
  select { display: block; min-height: 40px; max-width: 100%; margin-top: 3px; padding: 5px 7px; font: inherit;
    color: inherit; background: var(--card, #fbfaf6); border: 1px solid var(--border, #a4a89b); border-radius: 4px }
  select:focus-visible { outline: 2px solid var(--ring, #196a3e); outline-offset: 2px }
  section { display: grid; grid-template-columns: repeat(2, minmax(0, 390px)); gap: 12px; margin-block-start: 14px }
  figure { margin: 0; min-width: 0 }
  img { display: block; width: 100%; height: auto; margin-top: 5px; border: 1px solid var(--border, #a4a89b) }
  [data-view="after"] .before, [data-view="before"] .after { display: none }
  [data-view="after"], [data-view="before"] { grid-template-columns: minmax(0, 390px) }
  @media (max-width: 600px) {
    section { grid-template-columns: minmax(0, 390px) }
    [data-view="auto"] .before { display: none }
  }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark } body { color: var(--foreground, #e9e8df) }
    select { background: var(--card, #22271f) }
  }
</style></head><body><main>
<header>
  <label>Pricing section<select id="section">${options}</select></label>
  <label>View<select id="view"><option value="auto">Auto</option><option value="both">Both versions</option>
    <option value="after">Revised only</option><option value="before">Earlier only</option></select></label>
</header>
<section aria-label="Phone pricing captures" data-view="auto">
  <figure class="before"><figcaption>Earlier</figcaption><img id="before" width="390" height="844" alt=""></figure>
  <figure class="after"><figcaption>Revised</figcaption><img id="after" width="390" height="844" alt=""></figure>
</section></main><script>
  const captures = ${JSON.stringify(captures)};
  const section = document.getElementById("section");
  function showSection() {
    const pair = captures[section.value];
    const name = section.selectedOptions[0].textContent;
    ["before", "after"].forEach((version, i) => {
      const image = document.getElementById(version);
      image.src = pair[i];
      image.alt = (i === 0 ? "Earlier" : "Revised") + " phone layout for " + name;
    });
  }
  section.addEventListener("change", showSection);
  document.getElementById("view").addEventListener("change", event => {
    document.querySelector("section").dataset.view = event.target.value;
  });
  showSection();
</script></body></html>`;
  writeFileSync(`${out}/pricing-phone.html`, html);
}
