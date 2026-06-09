import type { Preview } from "@storybook/react-vite";
// Load the app's global stylesheet so Tailwind tokens, themes, and fonts apply.
import "../src/app.css";

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
		controls: {
			matchers: { color: /(background|color)$/i, date: /Date$/i },
		},
	},
};

export default preview;
