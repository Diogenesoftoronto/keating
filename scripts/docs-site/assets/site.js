(() => {
  const input = document.querySelector("#docs-search");
  const status = document.querySelector("#search-status");
  const panel = document.querySelector("#search-results");
  const list = panel?.querySelector("ol");
  const search = document.querySelector(".search");
  if (!(input instanceof HTMLInputElement) || !status || !panel || !list || !search) return;

  input.disabled = false;
  status.textContent = "Search guide titles and contents. Press / to start.";
  let index;
  let loading;
  let version = 0;
  let timer;
  const normalize = text => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const tokens = text => normalize(text).match(/[\p{L}\p{N}]+/gu) || [];
  const close = () => { panel.hidden = true; };

  async function loadIndex() {
    if (index) return index;
    if (!loading) {
      loading = fetch("/search.json")
        .then(response => {
          if (!response.ok) throw Error("Search index unavailable");
          return response.json();
        })
        .then(pages => {
          if (!Array.isArray(pages) || !pages.length) throw Error("Search index empty");
          index = pages.map(page => ({
            ...page,
            normalizedTitle: normalize(page.title),
            normalizedDescription: normalize(page.description),
            text: normalize([page.title, page.description, page.group, ...page.sections.flatMap(section => [section.heading, section.text])].join(" ")),
          }));
          return index;
        })
        .finally(() => { loading = undefined; });
    }
    return loading;
  }
  function excerpt(text, terms) {
    const lower = normalize(text);
    const position = Math.max(0, Math.min(...terms.map(term => lower.indexOf(term)).filter(index => index >= 0)));
    const start = Number.isFinite(position) ? Math.max(0, position - 45) : 0;
    const end = Math.min(text.length, start + 185);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
  }
  async function runSearch() {
    const current = ++version;
    const query = input.value.trim();
    const terms = tokens(query);
    list.replaceChildren();
    close();
    if (!query) {
      status.textContent = "Search guide titles and contents. Press / to start.";
      return;
    }
    if (!terms.length) {
      status.textContent = "Try a word from the topic you need, such as account or quiz.";
      return;
    }
    status.textContent = "Searching the docs…";
    try {
      const pages = await loadIndex();
      if (current !== version) return;
      const matches = pages.filter(page => terms.every(term => page.text.includes(term)))
        .map(page => {
          const titleMatch = terms.every(term => page.normalizedTitle.includes(term));
          const descriptionMatch = terms.every(term => page.normalizedDescription.includes(term));
          const sections = page.sections.map(section => ({
            ...section,
            score: terms.reduce((score, term) => score + (normalize(section.heading).includes(term) ? 6 : 0) + (normalize(section.text).includes(term) ? 1 : 0), 0),
          })).sort((a, b) => b.score - a.score);
          const section = sections[0];
          return { page, section, titleMatch, score: (titleMatch ? 100 : 0) + (descriptionMatch ? 30 : 0) + (section?.score || 0) };
        }).sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title));
      const shown = matches.slice(0, 8);
      if (!shown.length) {
        status.textContent = `No guides match “${query}”. Try fewer words or browse the documentation.`;
        return;
      }
      status.textContent = `${matches.length} ${matches.length === 1 ? "guide" : "guides"} found${matches.length > 8 ? ", showing the first 8" : ""}. Use Tab or ↓ to browse results; Escape to close.`;
      const fragment = document.createDocumentFragment();
      for (const { page, section, titleMatch } of shown) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        // The builder creates these URLs; validate again before assigning an href.
        const url = titleMatch || !section?.score ? page.url : section.url;
        if (!/^\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:#section-[a-z0-9-]+)?$/.test(url)) continue;
        link.href = url;
        const group = document.createElement("span");
        group.className = "result-group";
        group.textContent = page.group;
        const title = document.createElement("span");
        title.className = "result-title";
        title.textContent = page.title;
        const description = document.createElement("span");
        description.className = "result-description";
        description.textContent = titleMatch || !section?.score ? page.description : `${section.heading}: ${excerpt(section.text, terms)}`;
        link.append(group, title, description);
        item.append(link);
        fragment.append(item);
      }
      list.append(fragment);
      panel.hidden = !list.children.length;
    } catch {
      if (current !== version) return;
      status.textContent = "Search couldn’t load. Try typing again, or browse the documentation.";
      close();
    }
  }
  input.addEventListener("input", () => {
    version++;
    clearTimeout(timer);
    close();
    timer = setTimeout(runSearch, 120);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim() && list.children.length) panel.hidden = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing &&
      !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))) {
      event.preventDefault();
      input.focus();
    }
    if (event.key === "Escape" && search.contains(document.activeElement)) {
      version++;
      clearTimeout(timer);
      input.focus();
      close();
      status.textContent = "Results closed. Edit your search to try again.";
    }
    if (!panel.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp") && search.contains(document.activeElement)) {
      const links = [...list.querySelectorAll("a")];
      const active = links.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? active + 1 : active - 1;
      event.preventDefault();
      if (next < 0) input.focus();
      else (links[next] || links[0])?.focus();
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!search.contains(event.target)) { version++; clearTimeout(timer); close(); }
  });
  search.addEventListener("focusout", event => {
    if (!search.contains(event.relatedTarget)) { version++; clearTimeout(timer); close(); }
  });

  const contents = document.querySelector(".page-contents");
  const sections = [...document.querySelectorAll(".article-section, .guide-directory, .directory-group, .developer-note")];
  if (contents && sections.length && "IntersectionObserver" in window) {
    const visible = new Set();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const current = sections.find(section => visible.has(section.id));
      if (!current) return;
      for (const link of contents.querySelectorAll("a[href^='#']")) {
        if (link.hash === `#${current.id}`) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    }, { rootMargin: "-110px 0px -55% 0px", threshold: 0 });
    sections.forEach(section => observer.observe(section));
  }

  // Surface tabs: synchronized switching, ARIA keyboard navigation, localStorage persistence
  const tabContainers = [...document.querySelectorAll("[data-surface-tabs]")];
  if (tabContainers.length) {
    const STORAGE_KEY = "keating_preferred_surface";
    const setSurface = (surface, persist = true) => {
      if (!["web", "tui", "cli"].includes(surface)) return;
      if (persist) {
        try { localStorage.setItem(STORAGE_KEY, surface); } catch {}
      }
      for (const container of tabContainers) {
        const buttons = [...container.querySelectorAll(".surface-tab-button")];
        const panels = [...container.querySelectorAll(".surface-tab-panel")];
        const targetButton = buttons.find(b => b.dataset.surface === surface);
        const targetPanel = panels.find(p => p.dataset.surface === surface);
        if (targetButton && targetPanel) {
          for (const b of buttons) {
            const active = b === targetButton;
            b.classList.toggle("is-active", active);
            b.setAttribute("aria-selected", active ? "true" : "false");
            b.setAttribute("tabindex", active ? "0" : "-1");
          }
          for (const p of panels) {
            const active = p === targetPanel;
            p.classList.toggle("is-active", active);
            if (active) p.removeAttribute("hidden");
            else {
              p.setAttribute("hidden", "");
              p.querySelectorAll("video").forEach(v => { try { v.pause(); } catch {} });
            }
          }
        }
      }
    };

    for (const container of tabContainers) {
      const buttons = [...container.querySelectorAll(".surface-tab-button")];
      buttons.forEach((button, index) => {
        const isActive = button.classList.contains("is-active");
        button.setAttribute("tabindex", isActive ? "0" : "-1");
        button.addEventListener("click", () => {
          const surface = button.dataset.surface;
          if (surface) setSurface(surface);
        });
        button.addEventListener("keydown", event => {
          let nextIndex = index;
          if (event.key === "ArrowRight") {
            nextIndex = (index + 1) % buttons.length;
          } else if (event.key === "ArrowLeft") {
            nextIndex = (index - 1 + buttons.length) % buttons.length;
          } else if (event.key === "Home") {
            nextIndex = 0;
          } else if (event.key === "End") {
            nextIndex = buttons.length - 1;
          } else {
            return;
          }
          event.preventDefault();
          const target = buttons[nextIndex];
          target.focus();
          const surface = target.dataset.surface;
          if (surface) setSurface(surface);
        });
      });
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSurface(saved, false);
    } catch {}
  }
})();
