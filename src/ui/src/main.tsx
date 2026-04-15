import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./app.css";

const el = document.getElementById("root");
if (!el) throw new Error("Root element #root not found in document");
createRoot(el).render(<App />);
