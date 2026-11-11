/**
 * Sample interactive pages written the way the tutor is asked to write them
 * (see INTERACTIVE_PAGE_AUTHORING_GUIDE). Used by the story and by tests that
 * check real authored pages pass the builder.
 */

export const GRADIENT_DESCENT_EXPLORER = {
	pageId: "sample-gradient-descent-explorer",
	title: "Gradient descent on a 1-D loss",
	description: "An explorer for gradient descent on the loss L(x) = (x − 1)² + 0.5. You choose a learning rate and a starting point, then step: each step moves x by −learning rate × slope (slope = 2(x − 1)). Small rates creep toward the minimum at x = 1, rates near 0.5 land almost at once, rates between 0.5 and 1 overshoot and zig-zag in, and rates above 1 overshoot further each step and diverge.",
	html: String.raw`<!doctype html>
<html lang="en">
<head>
<style>
  .gd { display: grid; gap: 12px; }
  .controls { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .field { display: grid; gap: 4px; }
  .field label { font-weight: 600; font-size: 13px; }
  .field output { font-family: var(--font-mono); font-size: 13px; color: var(--muted-foreground); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  svg { width: 100%; height: 220px; display: block; }
  .readout { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin: 0; }
  .readout div { background: var(--card); border-radius: var(--radius); padding: 8px 10px; }
  .readout dt { font-size: 12px; color: var(--muted-foreground); }
  .readout dd { margin: 0; font-family: var(--font-mono); }
  .verdict { margin: 0; font-weight: 600; }
</style>
</head>
<body>
<div class="gd">
  <div class="controls">
    <div class="field">
      <label for="lr">Learning rate</label>
      <input id="lr" type="range" min="0.02" max="1.1" step="0.01" value="0.1" aria-describedby="lr-value">
      <output id="lr-value" for="lr">0.10</output>
    </div>
    <div class="field">
      <label for="x0">Starting x</label>
      <input id="x0" type="range" min="-3" max="5" step="0.1" value="4" aria-describedby="x0-value">
      <output id="x0-value" for="x0">4.0</output>
    </div>
  </div>
  <div class="actions">
    <button type="button" id="step" class="primary">Take one step</button>
    <button type="button" id="run">Run 10 steps</button>
    <button type="button" id="reset">Reset</button>
    <button type="button" id="share">Tell my tutor what I see</button>
  </div>
  <svg id="plot" viewBox="0 0 400 220" role="img" aria-labelledby="plot-label"><title id="plot-label">Loss curve with the current x marked</title></svg>
  <dl class="readout">
    <div><dt>Step</dt><dd id="n">0</dd></div>
    <div><dt>x</dt><dd id="x">4.000</dd></div>
    <div><dt>Loss L(x)</dt><dd id="loss">9.500</dd></div>
    <div><dt>Slope</dt><dd id="slope">6.000</dd></div>
  </dl>
  <p class="verdict" id="verdict" aria-live="polite"></p>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var loss = function (x) { return (x - 1) * (x - 1) + 0.5; };
  var slope = function (x) { return 2 * (x - 1); };
  var saved = window.keating.getState();
  var s = saved && typeof saved.x === "number" ? saved : { lr: 0.1, x0: 4, x: 4, n: 0, trail: [4] };
  $("lr").value = s.lr; $("x0").value = s.x0;

  function color(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function sx(x) { return 20 + (x + 3) / 8 * 360; }
  function sy(y) { return 200 - Math.min(y, 17) / 17 * 180; }

  function draw() {
    var svg = $("plot"), d = "", i;
    for (i = 0; i <= 80; i++) { var x = -3 + i * 0.1; d += (i ? "L" : "M") + sx(x).toFixed(1) + " " + sy(loss(x)).toFixed(1); }
    var parts = ['<title id="plot-label">Loss curve with x at ' + s.x.toFixed(2) + ' after ' + s.n + ' steps</title>',
      '<path d="' + d + '" fill="none" stroke="' + color("--muted-foreground") + '" stroke-width="2"/>'];
    var trail = s.trail.slice(-12);
    for (i = 1; i < trail.length; i++) {
      parts.push('<line x1="' + sx(clamp(trail[i - 1])) + '" y1="' + sy(loss(trail[i - 1])) + '" x2="' + sx(clamp(trail[i])) + '" y2="' + sy(loss(trail[i])) + '" stroke="' + color("--chart-2") + '" stroke-dasharray="4 3"/>');
    }
    parts.push('<circle cx="' + sx(clamp(s.x)) + '" cy="' + sy(loss(s.x)) + '" r="7" fill="' + color("--primary") + '" stroke="' + color("--foreground") + '"/>');
    svg.innerHTML = parts.join("");
    $("lr-value").textContent = Number(s.lr).toFixed(2);
    $("x0-value").textContent = Number(s.x0).toFixed(1);
    $("n").textContent = s.n;
    $("x").textContent = Math.abs(s.x) > 1e6 ? "diverged" : s.x.toFixed(3);
    $("loss").textContent = Math.abs(s.x) > 1e6 ? "∞" : loss(s.x).toFixed(3);
    $("slope").textContent = Math.abs(s.x) > 1e6 ? "∞" : slope(s.x).toFixed(3);
    $("verdict").textContent = verdict();
  }
  function clamp(x) { return Math.max(-3, Math.min(5, x)); }
  function verdict() {
    if (s.n === 0) return "Pick a learning rate, then step.";
    if (Math.abs(s.x) > 50) return "Diverging: each step overshoots further than the last.";
    if (Math.abs(s.x - 1) < 0.01) return "Converged: x is at the minimum (x = 1).";
    var prev = s.trail[s.trail.length - 2];
    return (prev - 1) * (s.x - 1) < 0 ? "Overshooting: x jumped across the minimum." : "Approaching the minimum from one side.";
  }
  function save() { s.trail = s.trail.slice(-40); window.keating.setState(s); }
  function step() { if (Math.abs(s.x) > 1e6) return; s.x = s.x - s.lr * slope(s.x); s.n += 1; s.trail.push(s.x); }
  function reset() { s.x = Number(s.x0); s.n = 0; s.trail = [s.x]; }

  $("lr").addEventListener("input", function (e) { s.lr = Number(e.target.value); reset(); draw(); save(); });
  $("x0").addEventListener("input", function (e) { s.x0 = Number(e.target.value); reset(); draw(); save(); });
  $("step").addEventListener("click", function () { step(); draw(); save(); });
  $("reset").addEventListener("click", function () { reset(); draw(); save(); });
  $("run").addEventListener("click", function () {
    var left = 10;
    if (window.keating.reducedMotion) { while (left--) step(); draw(); save(); return; }
    (function tick() { step(); draw(); if (--left > 0) setTimeout(tick, 120); else save(); })();
  });
  $("share").addEventListener("click", function () {
    window.keating.share({
      summary: "With learning rate " + Number(s.lr).toFixed(2) + " from x = " + Number(s.x0).toFixed(1) + ", after " + s.n + " steps: " + verdict(),
      data: { learningRate: s.lr, start: s.x0, steps: s.n, x: Math.abs(s.x) > 1e6 ? null : s.x },
    }).then(function (r) { $("verdict").textContent = r.ok ? "Sent to your tutor." : "Not sent (" + r.reason + ")."; });
  });
  window.addEventListener("keating:context", draw);
  draw();
  window.keating.ready();
})();
</script>
</body>
</html>`,
};

export const LEARNING_RATE_EXERCISE = {
	pageId: "sample-learning-rate-check",
	title: "Check: learning rates",
	description: "A three-question check on learning rates for L(x) = (x − 1)² + 0.5. 1: which rate diverges (answer: 1.05). 2: what happens at rate 0.75 (answer: it overshoots and zig-zags in). 3: which rate lands on the minimum in one step (answer: 0.5). Checking shows which answers were right in words and sends the score to the tutor.",
	html: String.raw`<!doctype html>
<html lang="en">
<head>
<style>
  form { display: grid; gap: 14px; }
  fieldset { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin: 0; display: grid; gap: 6px; }
  legend { font-weight: 600; padding: 0 4px; }
  label { display: flex; gap: 8px; align-items: center; min-height: 32px; }
  .mark { font-weight: 600; margin: 4px 0 0; }
  .primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); justify-self: start; }
  #result { margin: 0; font-weight: 600; }
</style>
</head>
<body>
<form id="quiz" novalidate>
  <fieldset>
    <legend>1. For L(x) = (x − 1)² + 0.5, which learning rate diverges?</legend>
    <label><input type="radio" name="q1" value="0.1"> 0.1</label>
    <label><input type="radio" name="q1" value="0.5"> 0.5</label>
    <label><input type="radio" name="q1" value="1.05"> 1.05</label>
    <p class="mark" id="m1"></p>
  </fieldset>
  <fieldset>
    <legend>2. At learning rate 0.75, what does x do?</legend>
    <label><input type="radio" name="q2" value="creep"> Creeps toward x = 1 from one side</label>
    <label><input type="radio" name="q2" value="zigzag"> Overshoots and zig-zags in</label>
    <label><input type="radio" name="q2" value="diverge"> Runs away</label>
    <p class="mark" id="m2"></p>
  </fieldset>
  <fieldset>
    <legend>3. Which learning rate reaches the minimum in exactly one step?</legend>
    <label><input type="radio" name="q3" value="0.25"> 0.25</label>
    <label><input type="radio" name="q3" value="0.5"> 0.5</label>
    <label><input type="radio" name="q3" value="1"> 1</label>
    <p class="mark" id="m3"></p>
  </fieldset>
  <button type="button" id="check" class="primary">Check and send to tutor</button>
  <p id="result" aria-live="polite"></p>
</form>
<script>
(function () {
  var answers = { q1: "1.05", q2: "zigzag", q3: "0.5" };
  var form = document.getElementById("quiz");
  var saved = window.keating.getState() || {};
  Object.keys(saved.choices || {}).forEach(function (name) {
    var input = form.querySelector('input[name="' + name + '"][value="' + saved.choices[name] + '"]');
    if (input) input.checked = true;
  });
  function choices() {
    var out = {};
    Object.keys(answers).forEach(function (name) { var c = form.querySelector('input[name="' + name + '"]:checked'); if (c) out[name] = c.value; });
    return out;
  }
  form.addEventListener("change", function () { window.keating.setState({ choices: choices() }); });
  document.getElementById("check").addEventListener("click", function () {
    var picked = choices(), earned = 0, missed = [];
    Object.keys(answers).forEach(function (name, i) {
      var ok = picked[name] === answers[name];
      if (ok) earned++; else missed.push(i + 1);
      document.getElementById("m" + (i + 1)).textContent = ok ? "✓ Correct" : (picked[name] ? "✗ Not quite" : "✗ No answer");
    });
    var result = document.getElementById("result");
    result.textContent = "Score: " + earned + " of 3. Sending to your tutor…";
    window.keating.share({
      summary: "Learning-rate check: " + earned + "/3" + (missed.length ? " (missed question " + missed.join(", ") + ")" : " (all correct)"),
      data: { choices: picked },
      score: { earned: earned, possible: 3 },
      complete: true,
    }).then(function (r) {
      result.textContent = "Score: " + earned + " of 3. " + (r.ok ? "Sent to your tutor." : "Not sent (" + r.reason + "); try the button again.");
    });
  });
  window.keating.ready();
})();
</script>
</body>
</html>`,
};
