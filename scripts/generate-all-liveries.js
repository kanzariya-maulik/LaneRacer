const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = path.join(__dirname, '../public/model/liveries');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log('Reading base 4K Red Bull texture...');
const buf = fs.readFileSync(path.join(__dirname, 'extracted_img8.png'));
let pos = 8;
const idatChunks = [];
let width = 0, height = 0;
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  if (type === 'IHDR') {
    width = buf.readUInt32BE(pos + 8);
    height = buf.readUInt32BE(pos + 12);
  } else if (type === 'IDAT') {
    idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
  }
  pos += 12 + len;
}
const idat = Buffer.concat(idatChunks);
const raw = zlib.inflateSync(idat);
console.log('Uncompressed 4K base map: ' + width + 'x' + height);

function encodePng(w, h, rgbBuffer) {
  const stride = 1 + w * 3;
  const rawData = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    rawData[y * stride] = 0; // Filter None
    rgbBuffer.copy(rawData, y * stride + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idatData = zlib.deflateSync(rawData, { level: 6 });
  
  function makeChunk(type, data) {
    const len = data.length;
    const b = Buffer.alloc(12 + len);
    b.writeUInt32BE(len, 0);
    b.write(type, 4, 4, 'ascii');
    data.copy(b, 8);
    let crc = 0xFFFFFFFF;
    for (let i = 4; i < 8 + len; i++) {
      let byte = b[i];
      for (let j = 0; j < 8; j++) {
        crc = ((crc ^ byte) & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
        byte >>>= 1;
      }
    }
    b.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 8 + len);
    return b;
  }
  
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// Authentic team livery color configurations matching the classic procedural model paint styling
const TEAMS_CONFIG = {
  ferrari: {
    // Scuderia Ferrari: Rosso Corsa red, Giallo Modena yellow aero flowline, racing white
    base: [216, 10, 26],
    accent1: [255, 218, 0],       // Yellow racing stripes
    accent2: [248, 248, 250],     // White accent
    highlight: [248, 248, 250]
  },
  mercedes: {
    // Mercedes-AMG Petronas: Obsidian Black body with glowing Petronas turquoise flowlines
    base: [18, 19, 22],
    accent1: [0, 210, 190],       // Petronas Turquoise flowlines
    accent2: [200, 208, 216],     // Silver Arrow accent
    highlight: [0, 210, 190]
  },
  mclaren: {
    // McLaren F1 Team: Radiant Papaya Orange with Velocity Blue aerodynamic streaks
    base: [255, 128, 0],
    accent1: [20, 130, 255],      // Velocity Blue
    accent2: [28, 28, 32],        // Anthracite Carbon
    highlight: [20, 130, 255]
  },
  astonmartin: {
    // Aston Martin Aramco: Deep British Racing Green with Lime Essence accent stripes
    base: [0, 89, 79],
    accent1: [206, 220, 0],       // Lime Essence
    accent2: [245, 245, 245],     // White accent
    highlight: [206, 220, 0]
  },
  alpine: {
    // BWT Alpine F1 Team: French Royal Blue with vibrant BWT Racing Pink aerodynamic streaks
    base: [0, 120, 215],
    accent1: [255, 135, 188],     // BWT Racing Pink
    accent2: [245, 245, 248],     // French White
    highlight: [255, 135, 188]
  },
  williams: {
    // Williams Racing: Heritage Deep Navy Blue with Electric Cyan chevron speedlines
    base: [4, 30, 66],
    accent1: [0, 163, 224],       // Electric Cyan
    accent2: [225, 20, 32],       // Racing Red nose tip
    highlight: [0, 163, 224]
  },
  alphatauri: {
    // Visa Cash App RB: Midnight Navy with crisp Alpine Pure White engine cover & nose
    base: [2, 43, 68],
    accent1: [245, 245, 245],     // Pure White
    accent2: [37, 99, 235],       // Electric Blue
    highlight: [245, 245, 245]
  },
  alfaromeo: {
    // Alfa Romeo Stake: Biscione Crimson Burgundy with Carbon Obsidian aero panels
    base: [152, 30, 50],
    accent1: [20, 20, 22],        // Carbon Obsidian Black
    accent2: [245, 245, 248],     // Quadrifoglio White
    highlight: [245, 245, 248]
  },
  haas: {
    // Haas F1 Team: Arctic Pure White body with MoneyGram Racing Red streaks
    base: [242, 242, 244],
    accent1: [225, 6, 0],         // MoneyGram Red
    accent2: [28, 28, 30],        // Graphite Black
    highlight: [225, 6, 0]
  },
  'redbull-suzuka': {
    // Red Bull White Edition: Pearlescent Pure White with Hinomaru Crimson Red
    base: [246, 246, 248],
    accent1: [225, 6, 0],         // Hinomaru Red
    accent2: [225, 6, 0],         // Hinomaru Red
    highlight: [24, 24, 28]
  }
};

const outW = width, outH = height; // Full native 4K resolution (4096 x 4096)
const srcStride = 1 + width * 3;

for (const [teamId, cfg] of Object.entries(TEAMS_CONFIG)) {
  const tStart = Date.now();
  const rgbOut = Buffer.alloc(outW * outH * 3);
  let outIdx = 0;
  
  for (let y = 0; y < outH; y++) {
    const rowOffset = y * srcStride + 1;
    for (let x = 0; x < outW; x++) {
      const o = rowOffset + x * 3;
      const r = raw[o], g = raw[o+1], b = raw[o+2];
      
      const isUnpaintedCarbon = (r < 18 && g < 18 && b < 18);
      const isBullRed = (r > 130 && g < 70 && b < 70) || (r > 140 && g > 20 && b < 60 && r > g * 1.5);
      const isBullYellow = (r > 140 && g > 80 && b < 70);
      const isNavyPaint = (b > 15 && r < 60 && g < 60);
      const isSponsorArea = (r > 175 && g > 175 && b > 175);

      if (isUnpaintedCarbon) {
        // High-definition carbon fiber underbody / diffuser / floor (preserve authentic ambient occlusion)
        rgbOut[outIdx]   = Math.min(26, r + 4);
        rgbOut[outIdx+1] = Math.min(26, g + 4);
        rgbOut[outIdx+2] = Math.min(28, b + 4);
      } else if (isBullRed) {
        // Razor-sharp aerodynamic flowlines / team racing accent stripes
        rgbOut[outIdx]   = cfg.accent1[0];
        rgbOut[outIdx+1] = cfg.accent1[1];
        rgbOut[outIdx+2] = cfg.accent1[2];
      } else if (isBullYellow) {
        // Nose crest / engine fin secondary accent
        rgbOut[outIdx]   = cfg.accent2[0];
        rgbOut[outIdx+1] = cfg.accent2[1];
        rgbOut[outIdx+2] = cfg.accent2[2];
      } else if (isNavyPaint || isSponsorArea) {
        // Clean, rich, ultra-high-resolution team automotive bodywork paint (no mottled sponsor letters)
        // Subtle ambient occlusion modulation from surface curvature
        const lum = isNavyPaint ? Math.max(0.85, Math.min(1.15, b / 38)) : 1.0;
        rgbOut[outIdx]   = Math.min(255, Math.round(cfg.base[0] * lum));
        rgbOut[outIdx+1] = Math.min(255, Math.round(cfg.base[1] * lum));
        rgbOut[outIdx+2] = Math.min(255, Math.round(cfg.base[2] * lum));
      } else {
        // Smooth subpixel antialiasing with team base color
        const f = 0.72;
        rgbOut[outIdx]   = Math.round(r * (1 - f) + cfg.base[0] * f);
        rgbOut[outIdx+1] = Math.round(g * (1 - f) + cfg.base[1] * f);
        rgbOut[outIdx+2] = Math.round(b * (1 - f) + cfg.base[2] * f);
      }
      outIdx += 3;
    }
  }
  
  const pngData = encodePng(outW, outH, rgbOut);
  const filePath = path.join(outDir, `${teamId}.png`);
  fs.writeFileSync(filePath, pngData);
  console.log(`Generated 4K ${teamId}.png (${(pngData.length / 1024).toFixed(1)} KB) in ${Date.now() - tStart} ms`);
}
console.log('All team livery textures successfully generated at full 4K resolution!');
