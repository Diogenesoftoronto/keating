// The document and native controls still work when this enhancement is unavailable.
function enhanceTake(take) {
  const video = take.querySelector("video");
  const toggle = take.querySelector("[data-captions]");
  const links = [...take.querySelectorAll("[data-seek]")];
  const track = video.textTracks[0];

  if (track) {
    toggle.hidden = false;
    const updateToggle = () => toggle.setAttribute("aria-pressed", String(track.mode === "showing"));
    video.textTracks.addEventListener("change", updateToggle);
    toggle.addEventListener("click", () => {
      track.mode = track.mode === "showing" ? "disabled" : "showing";
      updateToggle();
    });
    updateToggle();
  }

  let activeLink;
  let pendingSeek;
  function updateStep(time) {
    // Media seeks are rounded to the decoder clock. Keep the clicked chapter
    // selected if the reported position lands just before its exact marker.
    const current = links.findLast(link => Number(link.dataset.seek) <= time + 0.001);
    if (current === activeLink) return;
    activeLink?.removeAttribute("aria-current");
    current?.setAttribute("aria-current", "step");
    activeLink = current;
  }

  video.addEventListener("timeupdate", () => updateStep(video.currentTime));
  video.addEventListener("seeking", () => updateStep(video.currentTime));
  video.addEventListener("loadedmetadata", () => {
    if (pendingSeek !== undefined) {
      video.currentTime = pendingSeek;
      pendingSeek = undefined;
    }
    updateStep(video.currentTime);
  });

  for (const link of links) {
    link.addEventListener("click", event => {
      if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || video.error) return;
      event.preventDefault();
      const position = Number(link.dataset.seek);
      if (video.readyState) video.currentTime = position;
      else {
        pendingSeek = position;
        video.preload = "auto";
      }
      updateStep(position);
    });
  }
  updateStep(0);
}

document.querySelectorAll(".walkthrough-take").forEach(enhanceTake);
