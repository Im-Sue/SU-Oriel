import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.js";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/animations.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("未找到前端挂载节点");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
