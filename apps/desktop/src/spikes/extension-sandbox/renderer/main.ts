import { mountPanel } from "./panel.js"

const root = document.getElementById("root")
if (root === null) throw new Error("Missing #root element")

mountPanel(root)
