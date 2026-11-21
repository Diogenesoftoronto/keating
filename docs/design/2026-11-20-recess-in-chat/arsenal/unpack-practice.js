import { inflateSync, strFromU8 } from "fflate";

// Restore presentation and lesson data before the game measures the arena.
const node = document.getElementById("flight-data");
const { practice, ...art } = JSON.parse(node.textContent);
const bytes = Uint8Array.from(atob(practice), char => char.charCodeAt(0));
const { stylesheet, flightProgram, ...lessons } = JSON.parse(strFromU8(inflateSync(bytes)));
document.getElementById("flight-style").textContent = stylesheet;
node.textContent = JSON.stringify({ ...art, ...lessons });
const script = document.createElement("script");
script.nonce = document.currentScript?.nonce || "";
script.textContent = flightProgram;
document.body.append(script);
