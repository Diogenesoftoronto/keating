import React from "react";
import ReactDOM from "react-dom/client";
import "./app.css";
import { App } from "./App";

if (import.meta.env.DEV) {
  import("react-grab");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
