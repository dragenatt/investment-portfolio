/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

// Create SVG icon with "IT" text
function createSVGIcon(size) {
  const radius = size * 0.2;
  const textSize = size * 0.35;
  const textX = size / 2;
  const textY = size / 2 + textSize * 0.35;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .bg { fill: #09090b; }
      .text { font-family: Arial, sans-serif; font-weight: bold; fill: #ffffff; font-size: ${textSize}px; text-anchor: middle; dominant-baseline: central; }
    </style>
  </defs>
  <rect class="bg" width="${size}" height="${size}" rx="${radius}" ry="${radius}"/>
  <text class="text" x="${textX}" y="${textY}">IT</text>
</svg>`;
}

// Write SVG files
const iconsDir = path.join(__dirname, '../public/icons');
fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [192, 512];
sizes.forEach(size => {
  const svg = createSVGIcon(size);
  const svgPath = path.join(iconsDir, `icon-${size}.svg`);
  fs.writeFileSync(svgPath, svg);
  console.log(`Created ${svgPath}`);
});

// Create maskable icon (same as regular but with full circle padding)
const maskableSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .bg { fill: #09090b; }
      .text { font-family: Arial, sans-serif; font-weight: bold; fill: #ffffff; font-size: 179.2px; text-anchor: middle; dominant-baseline: central; }
    </style>
  </defs>
  <circle class="bg" cx="256" cy="256" r="256"/>
  <text class="text" x="256" y="281.6">IT</text>
</svg>`;

const maskablePath = path.join(iconsDir, 'icon-maskable-512.svg');
fs.writeFileSync(maskablePath, maskableSVG);
console.log(`Created ${maskablePath}`);

console.log('All SVG icons created. SVG files can be 