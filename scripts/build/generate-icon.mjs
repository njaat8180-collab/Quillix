// QUILLIX app-icon generator.
//
// The Windows release was shipping with the default Electron icon because
// `build/icon.ico` and `build/icon.png` did not exist in the repository
// (electron-builder logged: "default Electron icon is used - application icon
// is not set"). This script renders the Quillix monogram - the same geometry as
// `src/components/QuillixMark.tsx` - into a PNG and a multi-size ICO.
//
// It intentionally uses only Node built-ins (zlib) so the release build needs no
// image toolchain and no new dependency.
//
// Usage: npm run icon:build
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CANVAS = 256;
const MONOGRAM_BOX = 0.78; // the 32x32 viewBox is inset so strokes never touch the edge
const HALF_STROKE = 1.5; // strokeWidth 3 in the 32x32 viewBox
const BG_TOP = [0x63, 0x66, 0xf1]; // --color-brand-500
const BG_BOTTOM = [0x43, 0x38, 0xca]; // --color-brand-700
const FG = [0xf8, 0xfa, 0xfc]; // --color-slate-50
const CORNER_RADIUS = 0.22; // fraction of the canvas

// --- geometry ---------------------------------------------------------------

/** Squared distance from point p to segment ab. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance to the outline of the rectangle (x0,y0)-(x1,y1); 0 when outside. */
function distanceToRectOutline(px, py, x0, y0, x1, y1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

/** Distance to a rounded rectangle (inside test uses the same radius). */
function roundedRectDistance(px, py, inset, radius) {
  const x0 = inset;
  const y0 = inset;
  const x1 = CANVAS - inset;
  const y1 = CANVAS - inset;
  const cx = Math.max(x0 + radius, Math.min(px, x1 - radius));
  const cy = Math.max(y0 + radius, Math.min(py, y1 - radius));
  const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1;
  const distance = Math.hypot(px - cx, py - cy);
  return inside ? -distance : distance;
}

function insideRoundedSquare(px, py) {
  const inset = CANVAS * 0.02;
  const radius = CANVAS * CORNER_RADIUS;
  return roundedRectDistance(px, py, inset, radius) <= 0;
}

/** True when the pixel belongs to one of the monogram strokes. */
function onMonogram(px, py) {
  const scale = (CANVAS * MONOGRAM_BOX) / 32;
  const offset = (CANVAS - CANVAS * MONOGRAM_BOX) / 2;
  const x = (px - offset) / scale;
  const y = (py - offset) / scale;
  if (x < -4 || x > 36 || y < -4 || y > 36) return false;
  const half = HALF_STROKE;
  // Rectangle outline: M7 5h19v20H7V5Z
  if (distanceToRectOutline(x, y, 7, 5, 26, 25) <= half) return true;
  // Diagonal tail: m17 17 11 12
  if (distanceToSegment(x, y, 17, 17, 28, 29) <= half) return true;
  // Horizontal tick: M2 12h9
  if (distanceToSegment(x, y, 2, 12, 11, 12) <= half) return true;
  // Vertical tick: M14 1v8
  if (distanceToSegment(x, y, 14, 1, 14, 9) <= half) return true;
  return false;
}

// --- rendering --------------------------------------------------------------

const SAMPLES = 3; // 3x3 supersampling for smooth edges

/** Returns RGBA pixels for one square image of the given size. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / CANVAS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgCoverage = 0;
      let fgCoverage = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = (x + (sx + 0.5) / SAMPLES) / scale;
          const py = (y + (sy + 0.5) / SAMPLES) / scale;
          if (!insideRoundedSquare(px, py)) continue;
          bgCoverage += 1;
          if (onMonogram(px, py)) fgCoverage += 1;
        }
      }
      const total = SAMPLES * SAMPLES;
      const offset = (y * size + x) * 4;
      if (bgCoverage === 0) continue; // fully transparent
      const mix = fgCoverage / bgCoverage;
      const t = (x / size + y / size) / 2;
      for (let channel = 0; channel < 3; channel += 1) {
        const bg = BG_TOP[channel] + (BG_BOTTOM[channel] - BG_TOP[channel]) * t;
        pixels[offset + channel] = Math.round(bg + (FG[channel] - bg) * mix);
      }
      pixels[offset + 3] = Math.round((bgCoverage / total) * 255);
    }
  }
  return pixels;
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO encoding -----------------------------------------------------------

/** 32-bit BGRA DIB entry (XOR bitmap + AND mask), as required by Windows. */
function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // BI_RGB
  const xorStride = size * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  header.writeUInt32LE(xorStride * size + maskStride * size, 20); // biSizeImage
  const xor = Buffer.alloc(xorStride * size);
  for (let y = 0; y < size; y += 1) {
    const sourceRow = (size - 1 - y) * size * 4; // DIB rows are bottom-up
    for (let x = 0; x < size; x += 1) {
      const source = sourceRow + x * 4;
      const target = y * xorStride + x * 4;
      xor[target] = rgba[source + 2]; // B
      xor[target + 1] = rgba[source + 1]; // G
      xor[target + 2] = rgba[source]; // R
      xor[target + 3] = rgba[source + 3]; // A
    }
  }
  const mask = Buffer.alloc(maskStride * size); // fully opaque via alpha channel
  return Buffer.concat([header, xor, mask]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + directory.length;
  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette size
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  });
  return Buffer.concat([header, directory, ...images.map(image => image.data)]);
}

// --- main -------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, '../..');
const outputDir = path.join(root, 'build');
fs.mkdirSync(outputDir, { recursive: true });

const master = render(CANVAS);
const png = encodePng(CANVAS, master);
fs.writeFileSync(path.join(outputDir, 'icon.png'), png);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => ({ size, data: encodeDib(size, render(size)) }));
fs.writeFileSync(path.join(outputDir, 'icon.ico'), encodeIco(images));

console.log(JSON.stringify({
  status: 'PASS',
  png: path.relative(root, path.join(outputDir, 'icon.png')),
  pngBytes: png.length,
  ico: path.relative(root, path.join(outputDir, 'icon.ico')),
  icoBytes: fs.statSync(path.join(outputDir, 'icon.ico')).size,
  sizes,
}));
