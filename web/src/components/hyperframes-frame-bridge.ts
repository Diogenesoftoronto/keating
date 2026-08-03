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
//   error   (iframe -> parent): { type: "keating-hyperframes-error", message, source? }

export const HYPERFRAMES_BRIDGE_SCRIPT = String.raw`
(function () {
  "use strict";

  var commandType = "keating-hyperframes-command";
  var stateType = "keating-hyperframes-state";
  var errorType = "keating-hyperframes-error";
  var pendingCommand = null;
  var hadTargets = false;
  var lastStateAt = 0;

  function errorMessage(value) {
    if (value && typeof value.message === "string" && value.message.trim()) return value.message.trim();
    if (typeof value === "string" && value.trim()) return value.trim();
    try {
      var serialized = JSON.stringify(value);
      return serialized && serialized !== "{}" ? serialized : "Animation runtime failed.";
    } catch (_error) {
      return "Animation runtime failed.";
    }
  }

  function postError(win, value, source) {
    win.parent.postMessage({
      type: errorType,
      message: errorMessage(value),
      source: source || undefined,
    }, "*");
  }

  function fitComposition(win) {
    try {
      if (!win.document || typeof win.document.querySelector !== "function") return;
      var root = win.document.querySelector("[data-width][data-height]");
      if (!root || !root.style) return;
      var width = Number(root.getAttribute("data-width"));
      var height = Number(root.getAttribute("data-height"));
      if (!(width > 0) || !(height > 0)) return;
      var viewportWidth = Math.max(1, win.innerWidth || width);
      var viewportHeight = Math.max(1, win.innerHeight || height);
      var scale = Math.min(viewportWidth / width, viewportHeight / height);
      root.style.transformOrigin = "top left";
      root.style.transform = "scale(" + scale + ")";
      root.style.position = "absolute";
      root.style.left = Math.max(0, (viewportWidth - width * scale) / 2) + "px";
      root.style.top = Math.max(0, (viewportHeight - height * scale) / 2) + "px";
      if (win.document.documentElement && win.document.documentElement.style) {
        win.document.documentElement.style.overflow = "hidden";
      }
      if (win.document.body && win.document.body.style) {
        win.document.body.style.overflow = "hidden";
      }
    } catch (error) {
      postError(win, error, "layout");
    }
  }

  function isTimeline(value) {
    return Boolean(value)
      && typeof value.play === "function"
      && typeof value.pause === "function"
      && typeof value.time === "function";
  }

  function timeline(win) {
    var registered = win.__timelines;
    if (registered && typeof registered === "object") {
      var names = Object.keys(registered);
      for (var index = 0; index < names.length; index += 1) {
        var candidate = registered[names[index]];
        if (isTimeline(candidate)) return candidate;
      }
    }
    var globalTimeline = win.gsap && win.gsap.globalTimeline;
    return isTimeline(globalTimeline) ? globalTimeline : null;
  }

  function nativeAnimations(win) {
    try {
      if (!win.document || typeof win.document.getAnimations !== "function") return [];
      return win.document.getAnimations({ subtree: true }).filter(function (animation) {
        return animation && typeof animation.play === "function" && typeof animation.pause === "function";
      });
    } catch (_error) {
      return [];
    }
  }

  function finiteDuration(value) {
    return typeof value === "number" && isFinite(value) && value > 0 && value < 100000 ? value : 0;
  }

  function duration(tl) {
    var total = typeof tl.totalDuration === "function" ? finiteDuration(tl.totalDuration()) : 0;
    if (total) return total;
    return typeof tl.duration === "function" ? finiteDuration(tl.duration()) : 0;
  }

  function animationDuration(animation) {
    try {
      var timing = animation.effect && typeof animation.effect.getComputedTiming === "function"
        ? animation.effect.getComputedTiming()
        : null;
      return finiteDuration(timing && timing.endTime);
    } catch (_error) {
      return 0;
    }
  }

  function timelineProgress(tl) {
    var total = duration(tl);
    return total ? Math.max(0, Math.min(1, tl.time() / total)) : 0;
  }

  function nativeProgress(animations) {
    var bestDuration = 0;
    var bestProgress = 0;
    for (var index = 0; index < animations.length; index += 1) {
      var animation = animations[index];
      var total = animationDuration(animation);
      var current = finiteDuration(animation.currentTime);
      if (total > bestDuration) {
        bestDuration = total;
        bestProgress = total ? Math.max(0, Math.min(1, current / total)) : 0;
      }
    }
    return { progress: bestProgress, seekable: bestDuration > 0 };
  }

  function timelineIsPlaying(tl) {
    return Boolean(tl) && (typeof tl.paused === "function" ? !tl.paused() : true);
  }

  function nativeIsPlaying(animations) {
    return animations.some(function (animation) {
      return animation.playState === "running" || animation.playState === "pending";
    });
  }

  function targets(win) {
    var tl = timeline(win);
    var animations = nativeAnimations(win);
    return { timeline: tl, animations: animations, available: Boolean(tl) || animations.length > 0 };
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
    var current = targets(win);
    var nativeState = nativeProgress(current.animations);
    var timelineDuration = current.timeline ? duration(current.timeline) : 0;
    var state = {
      type: stateType,
      progress: timelineDuration ? timelineProgress(current.timeline) : nativeState.progress,
      playing: timelineIsPlaying(current.timeline) || nativeIsPlaying(current.animations),
      hasTimeline: current.available,
      seekable: Boolean(timelineDuration) || nativeState.seekable,
    };
    win.parent.postMessage(state, "*");
  }

  function applyCommand(win, message) {
    var current = targets(win);
    var tl = current.timeline;
    var animations = current.animations;

    if (message.action !== "request-state" && !current.available) {
      pendingCommand = message;
    } else if (message.action === "play") {
      if (tl) tl.play();
      animations.forEach(function (animation) { animation.play(); });
    } else if (message.action === "pause") {
      if (tl) tl.pause();
      animations.forEach(function (animation) { animation.pause(); });
    } else if (message.action === "replay") {
      if (tl) {
        tl.pause(0);
        tl.play();
      }
      animations.forEach(function (animation) {
        animation.currentTime = 0;
        animation.play();
      });
    } else if (message.action === "seek") {
      var progress = Math.max(0, Math.min(1, message.progress));
      var total = tl ? duration(tl) : 0;
      if (tl && total) tl.pause(progress * total);
      animations.forEach(function (animation) {
        var animationTotal = animationDuration(animation);
        if (animationTotal) animation.currentTime = progress * animationTotal;
        animation.pause();
      });
    }
    postState(win);
  }

  function installHyperframesBridge(win) {
    fitComposition(win);
    win.addEventListener("resize", function () { fitComposition(win); });

    win.addEventListener("error", function (event) {
      var target = event && event.target;
      if (target && target !== win && target.tagName === "SCRIPT") {
        postError(win, "Animation dependency failed to load: " + (target.src || "external script"), "resource");
        return;
      }
      postError(win, event && (event.error || event.message), "runtime");
    }, true);

    win.addEventListener("unhandledrejection", function (event) {
      postError(win, event && event.reason, "promise");
    });

    win.addEventListener("message", function (event) {
      if (event.source && event.source !== win.parent) return;
      if (!isHyperframesCommand(event.data)) return;
      applyCommand(win, event.data);
    });

    function tick(now) {
      var available = targets(win).available;
      if (available && !hadTargets && pendingCommand) {
        var command = pendingCommand;
        pendingCommand = null;
        applyCommand(win, command);
      }
      hadTargets = available;
      if (typeof now !== "number" || now - lastStateAt >= 80) {
        postState(win);
        lastStateAt = typeof now === "number" ? now : lastStateAt;
      }
      win.requestAnimationFrame(tick);
    }

    win.requestAnimationFrame(tick);
  }

  installHyperframesBridge(window);
})();
`;
