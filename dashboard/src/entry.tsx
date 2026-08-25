import { render } from "preact";

import { App } from "./main";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("Dashboard root element is missing.");
render(<App />, root);
