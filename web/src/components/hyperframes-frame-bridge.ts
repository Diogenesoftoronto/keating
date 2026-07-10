// Bridge script injected into the sandboxed Hyperframes iframe.
//
// IMPORTANT: this must be plain, browser-runnable JavaScript that we inline as
// an inline <script> in the generated iframe document (see hyperframes-bridge.ts).
// It is intentionally NOT loaded as a separate module/asset: referencing this
// file via `new URL("./hyperframes-frame-bridge.ts", import.meta.url)` caused the
// bundler to emit the *raw TypeScript* as a `data:video/mp2t` asset, which the
// browser cannot execute — so the bridge never installed and every play/pause/
// replay/seek/loop command was silently dropped. Keeping the runtime payload as
// a string of valid JS avoids any TypeScript-compilation, MIME-type, and CSP
// sub-resource pitfalls, and works identically in dev and production builds.
//
// The parent controller counterpart lives in HyperframesPlayer.tsx. The two
// sides communicate via window.postMessage using these message shapes:
//   command (parent -> iframe): { type: "keating-hyperframes-command", action, progress? }
//   state   (iframe -> parent): { type: "keating-hyperframes-state", progress, playing, hasTimeline }

export const HYPERFRAMES_BRIDGE_SCRIPT = String.raw`
(function () {
  "use strict";

  var commandType = "keating-hyperframes-command";
  var stateType = "keating-hyperframes-state";

  function timeline(win) {
    return (win.gsap && win.gsap.globalTimeline) || null;
  }

  function duration(tl) {
    var total = typeof tl.totalDuration === "function" ? tl.totalDuration() : tl.duration();
    return isFinite(total) && total > 0 && total < 100000 ? total : 0;
  }

  function timelineProgress(tl) {
    var total = duration(tl);
    return total ? Math.max(0, Math.min(1, tl.time() / total)) : 0;
  }

  function isPlaying(tl) {
    return typeof tl.paused === "function" ? !tl.paused() : true;
  }

  function isHyperframesCommand(value) {
    if (!value || typeof value !== "object") return false;
    if (value.type !== commandType) return false;
    if (value.action === "seek") return typeof value.progress === "number" && isFinite(value.progress);
    return value.action === "play"
      || value.action === "pause"
      || value.action === "replay"
      || value.action === "request-state";
  }

  function postState(win) {
    var tl = timeline(win);
    var state = {
      type: stateType,
      progress: tl ? timelineProgress(tl) : 0,
      playing: tl ? isPlaying(tl) : false,
      hasTimeline: Boolean(tl),
    };
    win.parent.postMessage(state, "*");
  }

  function handleCommand(win, message) {
    var tl = timeline(win);
    if (!tl) {
      postState(win);
      return;
    }

    if (message.action === "play") tl.play();
    else if (message.action === "pause") tl.pause();
    else if (message.action === "replay") {
      tl.pause(0);
      tl.play();
    } else if (message.action === "seek") {
      var total = duration(tl);
      var progress = Math.max(0, Math.min(1, message.progress));
      if (total) tl.pause(progress * total);
    }

    postState(win);
  }

  function installHyperframesBridge(win) {
    win.addEventListener("message", function (event) {
      if (!isHyperframesCommand(event.data)) return;
      handleCommand(win, event.data);
    });

    function tick() {
      postState(win);
      win.requestAnimationFrame(tick);
    }

    win.requestAnimationFrame(tick);
  }

  installHyperframesBridge(window);
})();
`;
