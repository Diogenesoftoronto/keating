/**
 * Runtime injected into every interactive page as `window.keating`.
 *
 * Plain browser JavaScript kept as a string and inlined (see the comment at the
 * top of components/hyperframes-frame-bridge.ts for why Keating does not load
 * frame runtimes as separate assets). The config placeholder is replaced by
 * document.ts with a JSON literal escaped for an inline script.
 *
 * Nothing here is a security boundary: the page shares this realm and can
 * replace or bypass any of it. The host re-validates every message, checks the
 * gesture itself, and owns the rate limit. This script exists to give authors a
 * small, pleasant API and to route link clicks, Escape and sizing correctly.
 */

export const BRIDGE_CONFIG_PLACEHOLDER = "__KEATING_PAGE_CONFIG__";

export const INTERACTIVE_PAGE_BRIDGE_SCRIPT = String.raw`
(function () {
  "use strict";
  var config = __KEATING_PAGE_CONFIG__;
  var channel = config.channel;
  var parentWindow = window.parent;
  var state = config.state === undefined ? null : config.state;
  var stateTimer = 0;
  var pending = {};
  var nextId = 0;
  var readySent = false;
  var lastHeight = 0;

  function post(message) {
    message.source = "keating-interactive-page";
    message.channel = channel;
    try { parentWindow.postMessage(message, "*"); } catch (_error) { /* host gone */ }
  }

  function bytes(text) {
    try { return new TextEncoder().encode(text).length; } catch (_error) { return text.length * 3; }
  }

  function clone(value) {
    return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  function request(type, fields) {
    return new Promise(function (resolve) {
      var id = "r" + (++nextId);
      pending[id] = resolve;
      fields.type = type;
      fields.id = id;
      post(fields);
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; resolve({ ok: false, reason: "unavailable" }); }
      }, 10000);
    });
  }

  function applyContext(context) {
    if (!context || typeof context !== "object") return;
    var root = document.documentElement;
    var style = document.getElementById("keating-page-theme");
    var appearance = context.appearance === "dark" ? "dark" : "light";
    var css = ":root{color-scheme:" + appearance + ";";
    var vars = context.variables && typeof context.variables === "object" ? context.variables : {};
    for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name) && /^--[a-z0-9-]{1,48}$/.test(name)) {
        css += name + ":" + String(vars[name]).replace(/[;{}<>\\]/g, "").slice(0, 200) + ";";
      }
    }
    if (style) style.textContent = css + "}";
    root.setAttribute("data-theme", appearance);
    root.setAttribute("data-reduced-motion", context.reducedMotion ? "true" : "false");
    api.appearance = appearance;
    api.reducedMotion = Boolean(context.reducedMotion);
    try {
      window.dispatchEvent(new CustomEvent("keating:context", { detail: { appearance: appearance, reducedMotion: api.reducedMotion } }));
    } catch (_error) { /* old engines */ }
  }

  var api = {
    version: 1,
    appearance: config.context && config.context.appearance === "dark" ? "dark" : "light",
    reducedMotion: Boolean(config.context && config.context.reducedMotion),
    ready: function () {
      if (readySent) return;
      readySent = true;
      post({ type: "ready" });
      reportHeight();
    },
    getState: function () { return clone(state); },
    setState: function (value) {
      var text = JSON.stringify(value === undefined ? null : value);
      if (bytes(text) > config.maxStateBytes) throw new RangeError("keating.setState: state is larger than " + config.maxStateBytes + " bytes.");
      state = JSON.parse(text);
      clearTimeout(stateTimer);
      stateTimer = setTimeout(function () { post({ type: "state", state: state }); }, 200);
    },
    share: function (result) { return request("share", { result: result }); },
    openLink: function (url) { return request("open-link", { url: String(url) }); },
    onStateSaved: null,
  };

  try {
    Object.defineProperty(window, "keating", { value: api, writable: false, configurable: false, enumerable: true });
  } catch (_error) {
    window.keating = api;
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== parentWindow || !data || data.source !== "keating-interactive-host" || data.channel !== channel) return;
    if (data.type === "context") applyContext(data.context);
    else if (data.type === "reply" && typeof data.id === "string" && pending[data.id]) {
      var resolve = pending[data.id];
      delete pending[data.id];
      resolve(data.ok ? { ok: true } : { ok: false, reason: String(data.reason || "invalid") });
    } else if (data.type === "state-saved" && typeof api.onStateSaved === "function") {
      try { api.onStateSaved(Boolean(data.ok)); } catch (_error) { /* author callback */ }
    }
  });

  function reportHeight() {
    var root = document.documentElement;
    var body = document.body;
    var height = Math.ceil(Math.max(root.getBoundingClientRect().height, body ? body.scrollHeight : 0));
    if (!height || height === lastHeight) return;
    lastHeight = height;
    post({ type: "height", height: height });
  }

  if (window.ResizeObserver) {
    var observer = new ResizeObserver(reportHeight);
    observer.observe(document.documentElement);
    document.addEventListener("DOMContentLoaded", function () { if (document.body) observer.observe(document.body); });
  }
  document.addEventListener("DOMContentLoaded", reportHeight);
  window.addEventListener("load", function () {
    reportHeight();
    // Pages that never call ready() still become live once they have loaded.
    api.ready();
  });

  // Every link goes through the host: the frame must never navigate itself.
  document.addEventListener("click", function (event) {
    var target = event.target;
    var link = target && target.closest ? target.closest("a[href],area[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (href.charAt(0) === "#") return;
    event.preventDefault();
    var url;
    try { url = new URL(href, document.baseURI); } catch (_error) { return; }
    if (url.protocol === "http:" || url.protocol === "https:") api.openLink(url.href);
  }, true);

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !event.defaultPrevented) post({ type: "escape" });
  });

  window.addEventListener("error", function (event) {
    post({ type: "error", message: String((event && event.message) || "Script error") });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    post({ type: "error", message: String((reason && reason.message) || reason || "Unhandled rejection") });
  });
})();
`;
