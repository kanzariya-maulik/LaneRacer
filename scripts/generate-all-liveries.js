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

const TEAMS_CONFIG = {
  ferrari: {
    // Scuderia Rosso Corsa with Giallo Modena yellow airbox accents & black carbon stripes
    base: [225, 10, 25],
    secondary: [255, 220, 0],   // Yellow
    tertiary: [24, 24, 26],      // Carbon black stripe
    highlight: [245, 245, 245]   // White
  },
  mercedes: {
    // Silver Arrow with Petronas turquoise flowlines & neon yellow driver highlights
    base: [198, 204, 212],
    secondary: [235, 240, 45],   // Neon yellow
    tertiary: [0, 210, 190],     // Petronas Teal
    highlight: [0, 210, 190]     // Petronas Teal
  },
  mclaren: {
    // Papaya Orange with Velocity Blue aerodynamic accents & carbon black stripes
    base: [255, 128, 0],
    secondary: [20, 130, 255],   // Velocity Blue
    tertiary: [24, 24, 28],      // Carbon black
    highlight: [20, 130, 255]    // Velocity Blue
  },
  astonmartin: {
    // British Racing Emerald Green with Lime Essence aerodynamic accents
    base: [0, 89, 79],
    secondary: [206, 220, 0],    // Lime Essence
    tertiary: [206, 220, 0],     // Lime Essence
    highlight: [245, 245, 245]   // White
  },
  alpine: {
    // Alpine French Royal Blue with BWT Racing Pink aerodynamic streaks
    base: [0, 120, 215],
    secondary: [255, 135, 188],  // BWT Pink
    tertiary: [255, 135, 188],   // BWT Pink
    highlight: [245, 245, 245]   // French Tricolore White
  },
  williams: {
    // Williams Heritage Deep Navy Blue with Electric Cyan & Duracell Copper Orange
    base: [4, 30, 80],
    secondary: [255, 110, 20],   // Duracell Copper
    tertiary: [0, 163, 224],     // Electric Cyan
    highlight: [0, 163, 224]     // Electric Cyan
  },
  alphatauri: {
    // Midnight Matte Navy with Alpine Pure White bodywork & electric blue accents
    base: [2, 43, 68],
    secondary: [245, 245, 245],  // Matte White
    tertiary: [245, 245, 245],   // Matte White
    highlight: [37, 99, 235]     // Electric Blue
  },
  alfaromeo: {
    // Biscione Crimson Burgundy with Quadrifoglio Pure White & carbon black
    base: [152, 30, 50],
    secondary: [245, 245, 245],  // White
    tertiary: [22, 22, 24],      // Carbon black
    highlight: [245, 245, 245]   // White
  },
  haas: {
    // Arctic Pure White body with MoneyGram Racing Red stripes & graphite black
    base: [242, 242, 244],
    secondary: [225, 6, 0],      // MoneyGram Red
    tertiary: [225, 6, 0],       // Red
    highlight: [30, 31, 34]      // Graphite
  },
  'redbull-suzuka': {
    // Pearlescent Pure White Special Edition with Hinomaru Crimson Red
    base: [246, 246, 248],
    secondary: [225, 6, 0],      // Red
    tertiary: [225, 6, 0],       // Red
    highlight: [26, 26, 30]      // Graphite
  }
};

const outW = 2048, outH = 2048;
const srcStride = 1 + width * 3;

for (const [teamId, cfg] of Object.entries(TEAMS_CONFIG)) {
  const tStart = Date.now();
  const rgbOut = Buffer.alloc(outW * outH * 3);
  let outIdx = 0;
  
  for (let y = 0; y < outH; y++) {
    const sy = y * 2;
    for (let x = 0; x < outW; x++) {
      const sx = x * 2;
      const o = sy * srcStride + 1 + sx * 3;
      const r = raw[o], g = raw[o+1], b = raw[o+2];
      
      if (r < 15 && g < 15 && b < 15) {
        // Unpainted carbon fiber / floor / shadow
        rgbOut[outIdx] = r;
        rgbOut[outIdx+1] = g;
        rgbOut[outIdx+2] = b;
      } else if (b > 15 && r < 40 && g < 40) {
        // Primary Bodywork base paint (originally dark navy blue)
        // Modulate with subtle surface lighting / curvature shading
        const lum = b / 49;
        rgbOut[outIdx] = Math.min(255, Math.round(cfg.base[0] * lum));
        rgbOut[outIdx+1] = Math.min(255, Math.round(cfg.base[1] * lum));
        rgbOut[outIdx+2] = Math.min(255, Math.round(cfg.base[2] * lum));
      } else if (r > 160 && g > 110 && b < 60) {
        // Secondary graphics (originally Red Bull yellow)
        rgbOut[outIdx] = cfg.secondary[0];
        rgbOut[outIdx+1] = cfg.secondary[1];
        rgbOut[outIdx+2] = cfg.secondary[2];
      } else if (r > 160 && g < 80 && b < 60) {
        // Tertiary graphics (originally Red Bull red stripes)
        rgbOut[outIdx] = cfg.tertiary[0];
        rgbOut[outIdx+1] = cfg.tertiary[1];
        rgbOut[outIdx+2] = cfg.tertiary[2];
      } else if (r > 160 && g > 160 && b > 160) {
        // Sponsor / number plates (originally white)
        rgbOut[outIdx] = cfg.highlight[0];
        rgbOut[outIdx+1] = cfg.highlight[1];
        rgbOut[outIdx+2] = cfg.highlight[2];
      } else {
        // Edge transitions
        rgbOut[outIdx] = r;
        rgbOut[outIdx+1] = g;
        rgbOut[outIdx+2] = b;
      }
      outIdx += 3;
    }
  }
  
  const pngData = encodePng(outW, outH, rgbOut);
  const filePath = path.join(outDir, `${teamId}.png`);
  fs.writeFileSync(filePath, pngData);
  console.log(`Generated ${teamId}.png (${(pngData.length / 1024).toFixed(1)} KB) in ${Date.now() - tStart} ms`);
}
console.log('All team livery textures successfully generated!');
