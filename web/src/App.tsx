import { useEffect, useRef } from "react";

export function App() {
	const initializedRef = useRef(false);

	useEffect(() => {
		if (initializedRef.current) return;
		initializedRef.current = true;

		// Import the main module which initializes the app
		import("./main").then(({ initApp }) => {
			initApp();
		}).catch(console.error);
	}, []);

	return (
		<div
			id="app"
			className="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden"
		>
			<div id="header" className="shrink-0"></div>
			<div id="chat-container" className="flex-1 overflow-hidden"></div>
		</div>
	);
}
