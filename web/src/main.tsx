import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import App from "./App";
import "./index.css";
if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
