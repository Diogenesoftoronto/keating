import ReactDOM from "react-dom/client";
import "./app.css";
import { App } from "./App";
import { initThemeSync } from "./theme-sync";

if (import.meta.env.DEV) {
  import("react-grab");
}

initThemeSync();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
