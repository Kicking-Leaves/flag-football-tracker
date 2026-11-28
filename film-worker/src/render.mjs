// Renders the scoreboard to a transparent full-frame PNG for download cuts.

import { readFile } from "node:fs/promises";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { scorebugTree } from "./lib.mjs";

const FONT_PATH = process.env.SCOREBUG_FONT || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
let font = null;

export async function renderScorebugPng(bug, { width, height, scale, position }) {
  font ??= await readFile(FONT_PATH);
  const svg = await satori(scorebugTree(bug, { width, height, scale, position }), {
    width,
    height,
    fonts: [{ name: "Scorebug", data: font, weight: 700, style: "normal" }],
  });
  return new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
}
