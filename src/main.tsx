import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/map.css";
import "./styles/themes/morrowind.css";
import "./styles/themes/daggerfall.css";
import "./styles/themes/oblivion.css";
import "./styles/themes/skyrim.css";
import "./styles/themes/falloutnv.css";
import "./styles/themes/kotor.css";
import "./styles/themes/gothic.css";
import "./styles/themes/stalker.css";

createRoot(document.getElementById("root")!).render(<App />);
