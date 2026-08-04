import { useEffect, useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { css } from "../../styled-system/css";

export interface MultiSelectOption<T extends string> {
	value: T;
	label: string;
}

export interface MultiSelectDropdownProps<T extends string> {
	label: string;
	allLabel: string;
	options: readonly MultiSelectOption<T>[];
	selected: readonly T[];
	onChange: (selected: T[]) => void;
}

export function MultiSelectDropdown<T extends string>({
	label,
	allLabel,
	options,
	selected,
	onChange,
}: MultiSelectDropdownProps<T>) {
	const detailsRef = useRef<HTMLDetailsElement>(null);
	const selectedSet = new Set(selected);
	const summary = selected.length === 0
		? allLabel
		: selected.length === 1
			? options.find((option) => option.value === selected[0])?.label ?? selected[0]
			: `${selected.length} selected`;

	useEffect(() => {
		const closeOnOutsideClick = (event: MouseEvent) => {
			const details = detailsRef.current;
			if (details?.open && !details.contains(event.target as Node)) details.open = false;
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !detailsRef.current?.open) return;
			detailsRef.current.open = false;
			detailsRef.current.querySelector("summary")?.focus();
		};
		document.addEventListener("mousedown", closeOnOutsideClick);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("mousedown", closeOnOutsideClick);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, []);

	const toggle = (value: T) => {
		onChange(selectedSet.has(value)
			? selected.filter((entry) => entry !== value)
			: [...selected, value]);
	};

	return (
		<details ref={detailsRef} className={css({ position: "relative", minWidth: 0 })}>
			<summary
				aria-label={label}
				className={css({
					display: "flex",
					minHeight: "2.25rem",
					cursor: "pointer",
					listStyle: "none",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "0.5rem",
					overflow: "hidden",
					borderRadius: "0.375rem",
					border: "2px solid var(--border)",
					background: "var(--background)",
					paddingInline: "0.625rem",
					fontSize: { base: "0.75rem", sm: "0.875rem" },
					"&::-webkit-details-marker": { display: "none" },
					_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "2px" },
				})}
			>
				<span className={css({ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{summary}</span>
				<ChevronDown size={14} aria-hidden="true" className={css({ flexShrink: 0, transition: "transform 150ms", "details[open] &": { transform: "rotate(180deg)" } })} />
			</summary>
			<div
				className={css({
					position: "absolute",
					top: "calc(100% + 0.25rem)",
					right: 0,
					zIndex: 30,
					width: "max-content",
					minWidth: "100%",
					maxWidth: "min(20rem, calc(100vw - 2rem))",
					maxHeight: "16rem",
					overflowY: "auto",
					borderRadius: "0.375rem",
					border: "2px solid var(--border)",
					background: "var(--background)",
					boxShadow: "var(--shadow-card)",
					padding: "0.25rem",
				})}
			>
				<button
					type="button"
					onClick={() => onChange([])}
					className={css({ display: "flex", width: "100%", alignItems: "center", gap: "0.5rem", borderRadius: "0.25rem", paddingInline: "0.5rem", paddingBlock: "0.375rem", textAlign: "left", fontSize: "0.75rem", color: "var(--foreground)", _hover: { background: "var(--accent)" } })}
				>
					<span className={css({ display: "inline-flex", width: "1rem", justifyContent: "center" })}>{selected.length === 0 && <Check size={13} />}</span>
					{allLabel}
				</button>
				{options.map((option) => (
					<label key={option.value} className={css({ display: "flex", cursor: "pointer", alignItems: "center", gap: "0.5rem", borderRadius: "0.25rem", paddingInline: "0.5rem", paddingBlock: "0.375rem", fontSize: "0.75rem", color: "var(--foreground)", _hover: { background: "var(--accent)" } })}>
						<input
							type="checkbox"
							checked={selectedSet.has(option.value)}
							onChange={() => toggle(option.value)}
							className={css({ flexShrink: 0 })}
						/>
						<span className={css({ overflowWrap: "anywhere" })}>{option.label}</span>
					</label>
				))}
			</div>
		</details>
	);
}
