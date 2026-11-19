import { useState } from "react";
import { Button, TextInput } from "../../../design-system/kit";
import { Select } from "../../Select";
import { ImageGenerationModelSelectorDialog } from "../../ModelSelector";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";
import {
	IMAGE_GENERATORS,
	getImageGenerator,
	DEFAULT_IMAGE_GENERATOR_ID,
	type ImageGeneratorId,
} from "../../../lib/image-generators";
import { SavedHint, SettingRow } from "../ui";
import { imageGeneratorChoice } from "./model-choices";

export function ImageSettings() {
	const [settings, update] = useKeatingUiSettings();
	const [picker, setPicker] = useState(false);
	const generator =
		getImageGenerator(settings.imageGenerator) ??
		getImageGenerator(DEFAULT_IMAGE_GENERATOR_ID)!;
	const model = settings.imageModel || generator.models[0] || "";
	return (
		<div id="settings-section-ui-images" className="s2-pane">
			<p>
				Choose which generator the <code>generate_image</code> tool uses. When
				none is configured, the tool returns a message instead of an image.
			</p>
			<SettingRow
				id="image-generator"
				label="Generator"
				help={generator.description}
				scope="this device"
			>
				<Select
					aria-labelledby="image-generator-label"
					value={settings.imageGenerator}
					onValueChange={(id) =>
						update(imageGeneratorChoice(id as ImageGeneratorId))
					}
				>
					{IMAGE_GENERATORS.map((g) => (
						<option key={g.id} value={g.id}>
							{g.label}
						</option>
					))}
				</Select>
			</SettingRow>
			{generator.needsBaseUrl && (
				<SettingRow
					id="image-endpoint"
					label="Local endpoint base URL"
					scope="this device"
					help={
						"Base URL of your local OpenAI-compatible server. If it needs a key, store it under " +
						generator.providerKey +
						" in Providers and keys."
					}
				>
					<TextInput
						aria-labelledby="image-endpoint-label"
						placeholder="http://localhost:1234"
						value={settings.localImageBaseUrl}
						onChange={(e) => update({ localImageBaseUrl: e.target.value })}
					/>
				</SettingRow>
			)}
			<SettingRow
				id="image-model"
				label="Model"
				scope="this device"
				help={
					generator.models.length
						? "Image model used for this generator."
						: "Model id exposed by your local server."
				}
			>
				{generator.models.length ? (
					<Button aria-haspopup="dialog" onClick={() => setPicker(true)}>
						{model}
					</Button>
				) : (
					<TextInput
						aria-labelledby="image-model-label"
						placeholder="e.g. sd3.5, flux.1-dev"
						value={model}
						onChange={(e) => update({ imageModel: e.target.value })}
					/>
				)}
			</SettingRow>
			<ImageGenerationModelSelectorDialog
				open={picker}
				generator={generator}
				currentModelId={model}
				onClose={() => setPicker(false)}
				onSelect={(id) => update({ imageModel: id })}
			/>
			<SettingRow
				id="image-size"
				label="Image size"
				help="Default dimensions when the tool does not specify a size."
				scope="this device"
			>
				<Select
					aria-labelledby="image-size-label"
					value={settings.imageSize || generator.sizes[0]}
					onValueChange={(imageSize) => update({ imageSize })}
				>
					{generator.sizes.map((v) => (
						<option key={v}>{v}</option>
					))}
				</Select>
			</SettingRow>
			<SettingRow
				id="image-quality"
				label="Image quality"
				help="Default quality when the tool does not specify one."
				scope="this device"
			>
				<Select
					aria-labelledby="image-quality-label"
					value={settings.imageQuality || generator.qualities[0]}
					onValueChange={(imageQuality) => update({ imageQuality })}
				>
					{generator.qualities.map((v) => (
						<option key={v}>{v}</option>
					))}
				</Select>
			</SettingRow>
			<SavedHint />
		</div>
	);
}
