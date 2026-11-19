// Run as a CDP evalFile with Build open on a disposable course containing a lesson.
(async () => {
  const builder = document.querySelector(".cb-builder");
  const editor = builder?.querySelector('[aria-label="Lesson editor"]');
  if (!editor) throw new Error("Open a desktop lesson editor before running the builder checks.");
  const find = (root, text) => [...root.querySelectorAll("button")].find(control => control.textContent.trim() === text);
  const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = (condition, description) => { if (!condition) throw new Error(description); };
  const click = async control => { check(control, "Missing control"); control.click(); await tick(); };
  const title = editor.querySelector(".cb-title-fields input");
  const original = title.value;
  const changeTitle = async value => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(title, value);
    title.dispatchEvent(new Event("input", {bubbles:true}));
    await tick();
  };
  check(find(editor, "Save lesson").disabled, "An unchanged lesson should have Save disabled");
  await changeTitle(original + " revised");
  check(!find(editor, "Save lesson").disabled && editor.textContent.includes("1 unsaved"), "A changed title should enable Save");
  await changeTitle("");
  check(find(editor, "Save lesson").disabled && editor.textContent.includes("Enter a lesson title"), "A blank title needs an explanation");
  await click(find(editor, "Discard"));
  check(title.value === original && find(editor, "Discard").disabled, "Discard should restore the saved lesson");
  await click(find(editor, "Add question"));
  check(find(editor, "Save lesson").disabled && editor.textContent.includes("Enter a question prompt"), "An enabled question needs a prompt");
  await click(find(editor, "Discard"));
  for (const control of [find(editor, "Remove lesson"), builder.querySelector(".cb-module-head [aria-label^='Remove']")]) {
    await click(control);
    const dialog = document.querySelector('dialog[role="alertdialog"][open]');
    check(dialog && find(dialog, "Remove"), "Deletion requires explicit confirmation");
    await click(find(dialog, "Cancel"));
    check(!document.querySelector('dialog[role="alertdialog"][open]') && builder.contains(control), "Cancel should preserve the item");
  }
  return "Passed lesson change, discard, validation and both removal confirmations";
})()
