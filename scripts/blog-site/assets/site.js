// Reading and filtering work without JavaScript; this only remembers theme.
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
