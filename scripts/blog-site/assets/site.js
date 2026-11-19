// Reading and filtering work without JavaScript.
const toggle = document.querySelector(".theme-toggle");
let preference;
try { preference = localStorage.getItem("keating-blog-theme"); } catch {}
if (preference === "light" || preference === "dark") document.documentElement.dataset.theme = preference;
if (toggle) {
  toggle.hidden = false;
  toggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("keating-blog-theme", next); } catch {}
    toggle.setAttribute("aria-label", `Switch to ${current} theme`);
  });
}

const outline = document.querySelector(".article-outline");
if (outline) {
  const headings = document.querySelectorAll(".prose :is(h1,h2,h3)");
  if (headings.length > 1) {
    const navigation = outline.querySelector("nav");
    headings.forEach((heading, index) => {
      heading.id ||= `article-section-${index + 1}`;
      const anchor = document.createElement("a");
      anchor.href = `#${heading.id}`;
      anchor.textContent = heading.textContent;
      navigation.append(anchor);
    });
    const markCurrent = () => {
      for (const link of navigation.querySelectorAll("a")) {
        if (link.hash === location.hash) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    };
    markCurrent();
    window.addEventListener("hashchange", markCurrent);
    outline.open = matchMedia("(min-width: 800px)").matches;
    outline.hidden = false;
    // The browser may have looked for a bookmarked heading before the deferred script ran.
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && [...headings].includes(target)) target.scrollIntoView();
  }
}
