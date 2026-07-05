import type { Preview } from "@storybook/react-vite";
import "@earendil-works/pi-web-ui/app.css";
// Load Panda's generated stylesheet so tokens/recipes, themes, and fonts apply.
import "../styled-system/styles.css";

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
		controls: {
			matchers: { color: /(background|color)$/i, date: /Date$/i },
		},
	},
};

export default preview;
