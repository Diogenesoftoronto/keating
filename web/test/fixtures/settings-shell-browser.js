// Run as an evalFile step in the design-pass CDP harness at 390 × 844, on a seeded chat.
(async () => {
	const checks = [];
	const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
	const check = (name, condition) => {
		if (!condition) throw Error(name);
		checks.push(name);
	};
	const find = (selector) => document.querySelector(selector);
	const fire = (target, event, detail) =>
		target.dispatchEvent(
			new CustomEvent(event, { detail, bubbles: true, cancelable: true }),
		);
	const key = (target, value, shiftKey = false) =>
		target.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: value,
				shiftKey,
				bubbles: true,
				cancelable: true,
			}),
		);
	const clickText = (selector, text) =>
		[...document.querySelectorAll(selector)]
			.find((button) => button.textContent.trim() === text)
			?.click();
	const edit = (field, value) => {
		Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(field),
			"value",
		).set.call(field, value);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const launcher = find('[aria-label="More menu"]');
	launcher.focus();
	launcher.click();
	await pause();
	clickText("[role=menuitem],button", "Settings");
	await pause();
	const modal = find("dialog.st-dialog[open]");
	check(
		"named modal",
		modal &&
			modal.matches(":modal") &&
			find("#" + modal.getAttribute("aria-labelledby")).textContent ===
				"Settings",
	);
	check("focus inside", modal.contains(document.activeElement));
	check(
		"phone group list",
		[...modal.querySelectorAll(".st-group")].every(
			(el) => el.getBoundingClientRect().height >= 44,
		),
	);
	find(".st-group[data-group=interface]").click();
	await pause();
	check(
		"phone section page",
		find(".st-mobilebar").getBoundingClientRect().height > 0 &&
			!find(".st-outline").getBoundingClientRect().height,
	);
	const search = find('[aria-label="Find a setting"]');
	key(document.activeElement, "/");
	check("slash focuses search", document.activeElement === search);
	edit(search, "appearance");
	await pause();
	key(search, "ArrowDown");
	key(search, "ArrowUp");
	key(search, "Enter");
	await pause();
	check("old name focuses row", document.activeElement?.id === "theme");
	search.focus();
	key(search, "Tab", true);
	check(
		"backward tab wraps",
		document.activeElement !== search && modal.contains(document.activeElement),
	);
	key(document.activeElement, "Tab");
	check("forward tab wraps", document.activeElement === search);
	fire(window, "keating:settings-tab", { section: "persona" });
	await pause();
	const persona = find("#teacher-persona");
	const original = persona.value;
	edit(persona, original + " Browser draft");
	await pause();
	fire(window, "keating:settings-tab", { section: "display" });
	await pause();
	check(
		"draft survives navigation",
		find("#teacher-persona").value.endsWith(" Browser draft"),
	);
	find('[aria-label="Close settings"]').click();
	await pause();
	check(
		"unsaved close asks once",
		document.querySelectorAll("dialog[role=alertdialog][open]").length === 1,
	);
	clickText("dialog[role=alertdialog] button", "Keep editing");
	await pause();
	check(
		"keep editing retains draft",
		!find("dialog[role=alertdialog][open]") &&
			find("#teacher-persona").value.endsWith(" Browser draft"),
	);
	fire(modal, "cancel");
	await pause();
	clickText("dialog[role=alertdialog] button", "Discard");
	await pause();
	check("discard closes modal", !find("dialog.st-dialog[open]"));
	check(
		"launcher focus restored",
		document.activeElement === launcher ||
			document.activeElement?.textContent?.trim() === "Settings",
	);
	fire(window, "keating:open-settings", { section: "persona" });
	await pause();
	check("discard releases edits", find("#teacher-persona").value === original);
	edit(find("#teacher-persona"), original + " Browser save");
	await pause();
	fire(find("dialog.st-dialog"), "cancel");
	await pause();
	clickText("dialog[role=alertdialog] button", "Save");
	await pause();
	fire(window, "keating:open-settings", { section: "persona" });
	await pause();
	check(
		"save writes through existing editor",
		find("#teacher-persona").value.endsWith(" Browser save"),
	);
	fire(find("dialog.st-dialog"), "cancel");
	await pause();
	check("Escape cancel closes clean modal", !find("dialog.st-dialog[open]"));
	return checks;
})().catch((error) => ({
	failure: String(error),
	focus: document.activeElement?.outerHTML.slice(0, 300),
	heading: document.querySelector("#st-heading")?.textContent,
	body: document.body.innerText.slice(-700),
}));
