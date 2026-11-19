import type { Ref } from "react";
import { Kbd } from "../../../design-system/kit";
import { KeatingGlyph } from "../../../design-system/glyphs";
import { ScopeTag } from "../ui";
import type { searchSettings } from "./index";

interface SearchProps {
	query: string;
	index: number;
	results: ReturnType<typeof searchSettings>;
	selectResult(index: number): void;
}
export function SettingsSearchField({
	ref: input,
	query,
	index,
	results,
	selectResult,
	setQuery,
	setIndex,
}: SearchProps & {
	ref: Ref<HTMLInputElement>;
	setQuery(value: string): void;
	setIndex(index: number): void;
}) {
	return (
		<label className="st-find">
			<KeatingGlyph name="search" />
			<input
				ref={input}
				role="combobox"
				aria-autocomplete="list"
				aria-controls="st-results"
				aria-expanded={!!query.trim()}
				aria-activedescendant={
					results[index] ? "st-result-" + index : undefined
				}
				aria-label="Find a setting"
				placeholder="Find a setting"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setIndex(0);
				}}
				onKeyDown={(e) => {
					if (!query) return;
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						setQuery("");
						return;
					}
					if (["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
						e.preventDefault();
						if (e.key === "Enter") selectResult(index);
						else if (results.length) {
							const next =
								(index + (e.key === "ArrowDown" ? 1 : -1) + results.length) %
								results.length;
							setIndex(next);
							document
								.getElementById("st-result-" + next)
								?.scrollIntoView({ block: "nearest" });
						}
					}
				}}
			/>
			<Kbd>/</Kbd>
		</label>
	);
}
export function SettingsSearchResults({
	query,
	index,
	results,
	selectResult,
}: SearchProps) {
	return (
		<div className="st-results" hidden={!query.trim()}>
			<div id="st-results" role="listbox" aria-label="Matching settings">
				{results.map((e, i) => (
					<button
						key={e.section + e.id}
						type="button"
						role="option"
						aria-selected={index === i}
						id={"st-result-" + i}
						onClick={() => selectResult(i)}
					>
						<strong>{e.label}</strong> <ScopeTag scope={e.scope} />
						<small>{e.path}</small>
					</button>
				))}
			</div>
			{!results.length && <p role="status">No settings found.</p>}
		</div>
	);
}
