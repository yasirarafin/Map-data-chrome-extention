const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Ensure icons directory exists
const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Function to generate a simple RGBA image buffer with a map pin / target badge
function generateIconRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size * 0.42;
  const r = size * 0.35;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded background square with subtle gradient
      const rx = Math.abs(x - cx);
      const ry = Math.abs(y - size / 2);
      const cornerR = size * 0.22;
      const innerHalf = size / 2 - cornerR;
      let inBox = false;

      if (rx <= size / 2 && ry <= size / 2) {
        if (rx <= innerHalf || ry <= innerHalf) {
          inBox = true;
        } else {
          const cdx = rx - innerHalf;
          const cdy = ry - innerHalf;
          if (cdx * cdx + cdy * cdy <= cornerR * cornerR) {
            inBox = true;
          }
        }
      }

      if (inBox) {
        // Gradient from Indigo (#4F46E5) to Cyan (#06B6D4)
        const t = (x + y) / (size * 2);
        const rVal = Math.round(79 * (1 - t) + 6 * t);
        const gVal = Math.round(70 * (1 - t) + 182 * t);
        const bVal = Math.round(229 * (1 - t) + 212 * t);

        buf[idx] = rVal;
        buf[idx + 1] = gVal;
        buf[idx + 2] = bVal;
        buf[idx + 3] = 255;

        // Draw pin head (circle)
        if (dist <= r) {
          // White pin outer
          buf[idx] = 255;
          buf[idx + 1] = 255;
          buf[idx + 2] = 255;
          buf[idx + 3] = 255;

          // Inner bullseye dot
          if (dist <= r * 0.45) {
            buf[idx] = 79;
            buf[idx + 1] = 70;
            buf[idx + 2] = 229;
            buf[idx + 3] = 255;
          }
        } else if (y >= cy && y <= size * 0.82) {
          // Pin bottom triangle tip
          const triWidth = (size * 0.82 - y) * (r / (size * 0.4));
          if (Math.abs(x - cx) <= triWidth) {
            buf[idx] = 255;
            buf[idx + 1] = 255;
            buf[idx + 2] = 255;
            buf[idx + 3] = 255;
          }
        }
      } else {
        // Transparent
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
      }
    }
  }
  return buf;
}

// Convert RGBA buffer to standard uncompressed/zlib PNG
function createPNG(size, rgba) {
  const width = size;
  const height = size;

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT chunk: filter byte (0) + row bytes
  const rowSize = width * 4;
  const rawData = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (rowSize + 1);
    rawData[rawOffset] = 0; // filter None
    rgba.copy(rawData, rawOffset + 1, y * rowSize, (y + 1) * rowSize);
  }

  const compressedData = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crc = crc32(buf.subarray(4, 8 + len));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  // Precompute CRC32
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressedData);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

[16, 48, 128].forEach(size => {
  const rgba = generateIconRGBA(size);
  const png = createPNG(size, rgba);
  const dest = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(dest, png);
  console.log(`Generated ${dest} (${png.length} bytes)`);
});
