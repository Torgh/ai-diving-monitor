// Generates the Android launcher icons and splash screens from the DiveDeck logo (public/icon.svg).
// Run with `bun run icons:mobile` after changing the logo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const res = at("../android/app/src/main/res/");
const svg = readFileSync(at("../../public/icon.svg"), "utf8");

/** Behind the logo on the splash screens: the deep end of the logo's water. */
const SPLASH = "#082f49";
/** The logo's parts, in the 512 × 512 viewBox: the water tile, and the bubbles in front. */
const group = (id) => {
  // Everything up to the group's closing tag, which sits at the group's own indent.
  const m = svg.match(new RegExp(String.raw`<g id="${id}"[^>]*>([\s\S]*?)\n  </g>`));
  if (!m) throw new Error(`public/icon.svg has no <g id="${id}">`);
  return m[1];
};
const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? "";
const background = group("background");
const artwork = group("artwork");
const svgOf = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${body}</svg>`);

/** `artwork` scaled to `scale` of a square canvas and centred, on an optional background. */
const compose = (scale, under = "") => {
  const offset = (512 * (1 - scale)) / 2;
  return svgOf(`${under}<g transform="translate(${offset} ${offset}) scale(${scale})">${artwork}</g>`);
};

/** The adaptive icon's background layer: the water to the edges (launchers cut their own shape). */
const adaptiveBackground = svgOf(`<rect width="512" height="512" fill="url(#depth)"/>`);

const png = (input, size, file) => sharp(input, { density: 600 }).resize(size, size).png().toFile(res + file);

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [name, k] of Object.entries(densities)) {
  // Adaptive icon (Android 8+): launchers mask the middle ~66 dp of the 108 dp layers to their own
  // shape. The water fills the whole background layer; the bubbles take about 60% of that circle.
  await png(adaptiveBackground, 108 * k, `mipmap-${name}/ic_launcher_background.png`);
  await png(compose(62 / 108), 108 * k, `mipmap-${name}/ic_launcher_foreground.png`);
  // Older launchers: the logo as it is, and a round version.
  await png(Buffer.from(svg), 48 * k, `mipmap-${name}/ic_launcher.png`);
  const disc = `<clipPath id="disc"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#disc)">${background}</g>`;
  await png(compose(0.8, disc), 48 * k, `mipmap-${name}/ic_launcher_round.png`);
}

// Splash before Android 12 (later versions show the launcher icon on the theme's splash colour).
const splashes = {
  drawable: [480, 320],
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(splashes)) {
  const logo = Math.round(Math.min(w, h) * 0.4);
  await sharp({ create: { width: w, height: h, channels: 4, background: SPLASH } })
    .composite([{ input: await sharp(Buffer.from(svg), { density: 600 }).resize(logo, logo).png().toBuffer() }])
    .png()
    .toFile(`${res}${dir}/splash.png`);
}

console.log("Android icons and splash screens updated.");
