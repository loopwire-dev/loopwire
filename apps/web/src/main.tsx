import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element #root was not found");
}

createRoot(root).render(
	<StrictMode>
		<ThemeProvider attribute="class" enableSystem defaultTheme="system">
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</ThemeProvider>
	</StrictMode>,
);
