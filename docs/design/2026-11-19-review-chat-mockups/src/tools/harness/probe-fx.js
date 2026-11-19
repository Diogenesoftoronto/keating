(() => {
  const cv = [...document.querySelectorAll('canvas.keating-fx-canvas, canvas[class*=fx]')];
  const visible = cv.filter(c => { const cs = getComputedStyle(c); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0; });
  const bodyBg = getComputedStyle(document.body).backgroundImage.slice(0, 80);
  return JSON.stringify({ fx: document.documentElement.dataset.fx, fxCanvases: cv.length, visible: visible.length, ready: document.querySelectorAll('[data-fx-ready]').length, bodyBg });
})()
