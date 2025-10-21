import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css"; // <- NEW: global styles

createRoot(document.getElementById("root")).render(<App />);
