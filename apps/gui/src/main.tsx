import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import "@wterm/react/css";
import "@fontsource-variable/inter";
import "@fontsource-variable/exo-2";
import "./styles.css";
import App from "./App";
import { installDevWebDesktopBridge } from "./app/dev-web-bridge";
import { queryClient } from "./app/query/query-client";

if (import.meta.env.DEV) {
  installDevWebDesktopBridge();

  if (import.meta.env.VITE_ENABLE_REACT_GRAB === "true") {
    void import("react-grab");
  }
}

try {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
} catch (error) {
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<pre class="bootstrap-error">Bootstrap error:\n${String(error)}</pre>`;
  }

  throw error;
}
