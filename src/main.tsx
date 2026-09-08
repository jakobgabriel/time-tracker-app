import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles/app.css";

// Long-press text selection and double-tap zoom get in the way of a tap target.
document.addEventListener("contextmenu", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
