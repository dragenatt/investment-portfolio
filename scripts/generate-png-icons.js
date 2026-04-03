/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function drawRoundedRectWithText(size, text, radius) {
  const png = new PNG({ width: size, height: size });

  // Fill background with dark color (#09090b)
  const bg = [9, 9, 11, 255]; // RGBA for #09090b
  const white = [255, 255, 255, 255]; // White for text

  // Fill entire image with background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      png.data[idx] = bg[0];
      png.data[idx + 1] = bg[1];
      png.data[idx + 2] = bg[2];
      png.data[idx + 3] = bg[3];
    }
  }

  // Apply rounded corners (simple corner fill)
  for (let y = 0; y < radius; y++) {
    for (let x = 0; x < radius; x++) {
      const dx = radius - x;
      const dy = radius - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) {
        // Top-left
        const idx1 = (size * y + x) << 2;
        png.data[idx1 + 3] = 0;
        // Top-right
        const idx2 = (size * y + (size - 1 - x)) << 2;
        png.data[idx2 + 3] = 0;
        // Bottom-left
        const idx3 = (size * (size - 1 - y) + x) << 2;
        png.data[idx3 + 3] = 0;
        // Bottom-right
        const idx4 = (size * (size - 1 - y) + (size - 1 - x)) << 2;
        png.data[idx4 + 3] = 0;
      }
    }
  }

  return png;
}

function drawCircle(size, text) {
  const png = new PNG({ width: size, height: size });

  const bg = [9, 9, 11, 255];
  const radius = size / 2;
  const centerX = size / 2;
  const centerY = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        png.data[idx] = bg[0];
        png.data[idx + 1] = bg[1];
        png.data[idx + 2] = bg[2];
        png.data[idx + 3] = 255;
      } else {
        png.data[idx + 3] = 0;
      }
    }
  }

  return png;
}

const iconsDir = path.join(__dirname, '../public/icons');
fs.mkdirSync(iconsDir, { recursive: true });

// Create 192x192 icon
const icon192 = drawRoundedRectWithText(192, 'IT', 38.4);
const png192Path = path.join(iconsDir, 'icon-192.png');
fs.createWriteStream(png192Path).write(PNG.sync.write(icon192));
console.log(`Created ${png192Path}`);

// Create 512x512 icon
const icon512 = drawRoundedRectWithText(512, 'IT', 102.4);
const png512Path = path.join(iconsDir, 'icon-512.png');
fs.createWriteStream(png512Path).write(PNG.sync.write(icon512));
console.log(`Created ${png512Path}`);

// Create maskable 512x512 icon (circular)
const maskable512 = drawCircle(512, 'IT');
const maskablePath = path.join(iconsDir, 'icon-maskable-512.png');
fs.createWriteStream(maskablePath).write(PNG.sync.write(maskable512));
console.log(`Created ${maskablePat