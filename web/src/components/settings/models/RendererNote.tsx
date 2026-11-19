import { DefinitionList } from "../../../design-system/kit";
export function RendererNote() {
	return (
		<div id="settings-section-ui-animation">
			<DefinitionList
				items={[
					{
						term: "Animation renderer",
						detail:
							"Keating creates browser animation artifacts as Hyperframes HTML compositions with timed clips and a GSAP timeline.",
					},
				]}
			/>
		</div>
	);
}
