// Turns the source photos in assets-src/ into the app's image assets.
// Run with `npm run images` after changing a source photo.
//
//  - brownie cutout (transparent background) for the currency icon and the jar
//  - PWA / favicon icons (cutout on a chocolate backdrop)
//  - welcome-screen hero photo
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(root, 'assets-src', f);
const genDir = path.join(root, 'src', 'assets', 'generated');
const iconDir = path.join(root, 'public', 'icons');
await mkdir(genDir, { recursive: true });
await mkdir(iconDir, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Brownie cutout: flood-fill the light, low-saturation background from the
//    image border, then feather and pull the edge in slightly to avoid a halo.
// ---------------------------------------------------------------------------
async function cutout(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const isBg = new Uint8Array(n);
  const looksLikeBg = (i) => {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // white backdrop + its soft grey cast shadow
    if ((lum > 168 && max - min < 34) || (lum > 110 && max - min < 24) || lum > 236) return true;
    // the cast shadow under the brownie picks up a warm tint; it only sits in
    // the lower part of the frame, away from the pale top crust
    const y = (i / w) | 0;
    return y > h * 0.6 && lum > 95 && (max - min) / max < 0.3;
  };
  const stack = [];
  const push = (i) => { if (!isBg[i] && looksLikeBg(i)) { isBg[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  // Remove small speckles: keep only the largest foreground blob.
  const label = new Int32Array(n).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let s = 0; s < n; s++) {
    if (isBg[s] || label[s] !== -1) continue;
    let size = 0;
    const q = [s];
    label[s] = id;
    while (q.length) {
      const i = q.pop();
      size++;
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !isBg[j] && label[j] === -1) { label[j] = id; q.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }

  // Fill interior holes (light crumbs inside the brownie stay opaque): anything
  // not reachable from the border as background is foreground.
  const mask = Buffer.alloc(n);
  for (let i = 0; i < n; i++) mask[i] = !isBg[i] && label[i] === best ? 255 : 0;

  // Erode ~2px then blur for a soft, halo-free edge.
  const eroded = await sharp(mask, { raw: { width: w, height: h, channels: 1 } })
    .blur(2.2).threshold(200).blur(1.1).extractChannel(0).raw().toBuffer();

  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = eroded[i];
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

const cut = await sharp(await cutout(src('brownie-single.jpg'))).trim({ threshold: 1 }).png().toBuffer();
const meta = await sharp(cut).metadata();
console.log(`brownie cutout ${meta.width}x${meta.height}`);

for (const size of [96, 256, 512]) {
  await sharp(cut)
    .resize({ width: size, height: size, fit: 'inside' })
    .modulate({ saturation: 1.08 })
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toFile(path.join(genDir, `brownie-${size}.webp`));
}

// ---------------------------------------------------------------------------
// 2. App icons: brownie on a glossy chocolate tile.
// ---------------------------------------------------------------------------
function tileSvg(size, radius) {
  return Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <radialGradient id="g" cx="50%" cy="34%" r="75%">
        <stop offset="0" stop-color="#6a3a20"/>
        <stop offset="0.55" stop-color="#36190c"/>
        <stop offset="1" stop-color="#1a0b05"/>
      </radialGradient>
      <radialGradient id="glow" cx="50%" cy="58%" r="40%">
        <stop offset="0" stop-color="#f0b45e" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#f0b45e" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
    <rect width="${size}" height="${size}" rx="${radius}" fill="url(#glow)"/>
  </svg>`);
}

async function icon(size, { padding, radius, file }) {
  const inner = Math.round(size * (1 - padding * 2));
  const brownie = await sharp(cut).resize({ width: inner, height: inner, fit: 'inside' }).toBuffer();
  const bm = await sharp(brownie).metadata();
  const shadow = await sharp(brownie)
    .ensureAlpha()
    .tint('#000000')
    .linear(1, 0)
    .blur(Math.max(1, size / 60))
    .toBuffer();
  const left = Math.round((size - bm.width) / 2);
  const top = Math.round((size - bm.height) / 2 + size * 0.02);
  await sharp(tileSvg(size, radius))
    .composite([
      { input: shadow, left, top: top + Math.round(size * 0.03), blend: 'multiply' },
      { input: brownie, left, top },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(iconDir, file));
}

await icon(512, { padding: 0.12, radius: 0, file: 'icon-512.png' });
await icon(192, { padding: 0.12, radius: 0, file: 'icon-192.png' });
await icon(512, { padding: 0.22, radius: 0, file: 'maskable-512.png' });
await icon(180, { padding: 0.12, radius: 0, file: 'apple-touch-icon.png' });
await icon(64, { padding: 0.06, radius: 14, file: 'favicon-64.png' });

// ---------------------------------------------------------------------------
// 3. Welcome hero.
// ---------------------------------------------------------------------------
await sharp(src('brownie-stack-dark.jpg'))
  .resize({ width: 1000 })
  .modulate({ saturation: 1.12, brightness: 1.02 })
  .webp({ quality: 74, effort: 6 })
  .toFile(path.join(genDir, 'hero.webp'));

console.log('images written');
