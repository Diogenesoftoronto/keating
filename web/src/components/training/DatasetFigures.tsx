import { StackBar, Stat } from "../../design-system/charts";

export function DatasetFigures({ records, examples, validation, counts }: {
	records: number; examples: number; validation: number; counts: Record<string, number>;
}) {
	const sources = [
		{ label: "Conversation responses", value: counts.session ?? 0 },
		{ label: "Teaching artifacts", value: counts.artifact ?? 0 },
		{ label: "Sandbox records", value: counts.sandbox ?? 0 },
	];
	return <>
		<div className="training-counts">
			<Stat label="Records" value={records}/>
			<Stat label="SFT examples" value={examples}/>
			<Stat label="Validation" value={validation}/>
		</div>
		<h3>Composition</h3>
		<StackBar data={sources} label="Dataset composition" size="lg"/>
	</>;
}
