// client/sprites.js
// Procedural NES-accurate sprite generation for Battle City
// Pre-renders all art into offscreen canvases at boot.

import { PALETTE } from '/shared/constants.js';

// Helper: Convert ASCII bitmap array to canvas
export function bitmapToCanvas(rows, palette) {
  const canvas = document.createElement('canvas');
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== '.' && ch !== ' ' && palette[ch]) {
        ctx.fillStyle = palette[ch];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas;
}

// Helper: Rotate a 16x16 canvas by quarter-turns (0=UP, 1=RIGHT, 2=DOWN, 3=LEFT)
export function rotateCanvas(source, turns) {
  if (turns === 0) return source;
  const canvas = document.createElement('canvas');
  const size = Math.max(source.width, source.height);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ctx.translate(size / 2, size / 2);
  ctx.rotate((turns * 90 * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

// Raw Bitmap Seeds (Facing UP)

// Basic Tank Seed (16x16)
// x/y = tread rows, B = body, b = body shade, h = turret light, G = barrel, k = outline
const TANK_SEED_BASIC = [
  '.......GG.......',
  '.......GG.......',
  'xxx...kGGk...xxx',
  'yyy..kBGGBk..yyy',
  'xxx..kBBBBk..xxx',
  'yyy.kBhhhhBk.yyy',
  'xxx.kBhhhhBk.xxx',
  'yyy.kBhhhhBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBBBBBBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBBBBBBk.yyy',
  'xxx.kBbbbbBk.xxx',
  'yyy.kBbbbbBk.yyy',
  'xxx..kkkkkk..xxx',
  'yyy..........yyy'
];

// Fast Tank Seed (Narrower body, sleeker)
const TANK_SEED_FAST = [
  '.......GG.......',
  '.......GG.......',
  'xxx....GG....xxx',
  'yyy...kBBk...yyy',
  'xxx..kBBBBk..xxx',
  'yyy..kBBBBk..yyy',
  'xxx.kkhhhkk..xxx',
  'yyy.kkhhhkk..yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBBBBBBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBbbbbBk.yyy',
  'xxx..kbbbbk..xxx',
  'yyy...kkkk...yyy',
  'xxx..........xxx',
  'yyy..........yyy'
];

// Power Tank Seed (Thicker 3px barrel, heavier turret)
const TANK_SEED_POWER = [
  '......GGG.......',
  '......GGG.......',
  'xxx...kGGk...xxx',
  'yyy..kGGGGk..yyy',
  'xxx..kBBBBk..xxx',
  'yyy.kkhhhhkk.yyy',
  'xxx.kkhhhhkk.xxx',
  'yyy.kkhhhhkk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBBBBBBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBbbbbBk.yyy',
  'xxx.kBbbbbBk.xxx',
  'yyy.kBbbbbBk.yyy',
  'xxx..kkkkkk..xxx',
  'yyy..........yyy'
];

// Armor Tank Seed (Bulky hull, wide turret ring)
const TANK_SEED_ARMOR = [
  '.......GG.......',
  '.......GG.......',
  'xxx..kkGGkk..xxx',
  'yyy.kBBGGBBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBhhhhBk.yyy',
  'xxx.kBhhhhBk.xxx',
  'yyy.kBhhhhBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBBBBBBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBBBBBBk.yyy',
  'xxx.kBbbbbBk.xxx',
  'yyy.kBbbbbBk.yyy',
  'xxx.kkkkkkkk.xxx',
  'yyy..........yyy'
];

// Player Star Level Upgrades (Star 1: longer barrel, Star 2: chevrons, Star 3: heavy plates)
const TANK_SEED_STAR3 = [
  '......GGGG......',
  '......GGGG......',
  'xxx...kGGk...xxx',
  'yyy..kGGGGk..yyy',
  'xxx.kkBBBBkk.xxx',
  'yyy.kBhhhhBk.yyy',
  'xxx.kBhhhhBk.xxx',
  'yyy.kBhhhhBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBBBBBBk.yyy',
  'xxx.kBBBBBBk.xxx',
  'yyy.kBbbbbBk.yyy',
  'xxx.kBbbbbBk.xxx',
  'yyy.kBbbbbBk.yyy',
  'xxx.kkkkkkkk.xxx',
  'yyy..........yyy'
];

export class SpriteAtlas {
  constructor() {
    this.tanks = {}; // key: `${type}_${treadFrame}_${dir}`
    this.terrain = {};
    this.eagle = {};
    this.bullet = null;
    this.explosions = { small: [], big: [] };
    this.stars = [];
    this.shields = [];
    this.powerups = {};
    this.hud = {};
  }

  init() {
    this.buildTerrain();
    this.buildEagle();
    this.buildBullet();
    this.buildExplosions();
    this.buildSpawnStar();
    this.buildShield();
    this.buildPowerups();
    this.buildHUD();
    this.buildAllTanks();
  }

  buildTerrain() {
    // 1. Brick 8x8 cell
    // r = BRICK_MAIN, l = BRICK_LIGHT, . = mortar (black)
    const brickRows = [
      'rrrrrrr.',
      'rrrrrrr.',
      'l.rrrrrr',
      '........',
      'rrr.rrrr',
      'rrr.rrrr',
      'lrr.rrrr',
      '........'
    ];
    const brickPal = {
      'r': PALETTE.BRICK_MAIN,
      'l': PALETTE.BRICK_LIGHT,
      '.': PALETTE.BRICK_DARK
    };
    const brickFull = bitmapToCanvas(brickRows, brickPal);
    this.terrain.brickFull = brickFull;

    // 4 individual quarters (4x4 each):
    // 0: TL, 1: TR, 2: BL, 3: BR
    this.terrain.brickQuarters = [];
    const offsets = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 4 }
    ];
    for (let i = 0; i < 4; i++) {
      const qCanvas = document.createElement('canvas');
      qCanvas.width = 4;
      qCanvas.height = 4;
      const qCtx = qCanvas.getContext('2d');
      qCtx.imageSmoothingEnabled = false;
      qCtx.drawImage(brickFull, offsets[i].x, offsets[i].y, 4, 4, 0, 0, 4, 4);
      this.terrain.brickQuarters.push(qCanvas);
    }

    // 2. Steel 8x8 cell
    const steelRows = [
      'WWSSSSSD',
      'WSSSSSSD',
      'SSSSSSSD',
      'SSSSSSSD',
      'SSSSSSSD',
      'SSSSSSSD',
      'SSSSSSSD',
      'DDDDDDDD'
    ];
    const steelPal = {
      'W': PALETTE.STEEL_LIGHT,
      'S': PALETTE.STEEL_MAIN,
      'D': PALETTE.STEEL_DARK
    };
    this.terrain.steel = bitmapToCanvas(steelRows, steelPal);

    // 3. Water 16x16 (2 frames)
    const waterFrame0Rows = [
      'BBBBLLBBBBLLBBBB',
      'BBBLLLLBBLLLLBBB',
      'BBLLBBLLLLBBLLBB',
      'BBLLBBLLLLBBLLBB',
      'BBBBLLBBBBLLBBBB',
      'LLBBBBLLLLBBBBLL',
      'LLLLBBLLLLBBLLLL',
      'BBLLLLBBBBLLLLBB',
      'BBBBLLBBBBLLBBBB',
      'BBBLLLLBBLLLLBBB',
      'BBLLBBLLLLBBLLBB',
      'BBLLBBLLLLBBLLBB',
      'BBBBLLBBBBLLBBBB',
      'LLBBBBLLLLBBBBLL',
      'LLLLBBLLLLBBLLLL',
      'BBLLLLBBBBLLLLBB'
    ];
    const waterFrame1Rows = [
      'LLBBBBLLLLBBBBLL',
      'LLLLBBLLLLBBLLLL',
      'BBLLLLBBBBLLLLBB',
      'BBBBLLBBBBLLBBBB',
      'BBBLLLLBBLLLLBBB',
      'BBLLBBLLLLBBLLBB',
      'BBLLBBLLLLBBLLBB',
      'BBBBLLBBBBLLBBBB',
      'LLBBBBLLLLBBBBLL',
      'LLLLBBLLLLBBLLLL',
      'BBLLLLBBBBLLLLBB',
      'BBBBLLBBBBLLBBBB',
      'BBBLLLLBBLLLLBBB',
      'BBLLBBLLLLBBLLBB',
      'BBLLBBLLLLBBLLBB',
      'BBBBLLBBBBLLBBBB'
    ];
    const waterPal = {
      'B': PALETTE.WATER_B,
      'L': PALETTE.WATER_A
    };
    this.terrain.water0 = bitmapToCanvas(waterFrame0Rows, waterPal);
    this.terrain.water1 = bitmapToCanvas(waterFrame1Rows, waterPal);

    // 4. Trees 16x16
    const treeRows = [
      '.MM..DDD..MM..DD',
      'MMMMDDDDDMMMMDDD',
      'MDDMMMDDDMDDMMMD',
      'DDDMMDDDDDDDMMDD',
      '.MM..DDD..MM..DD',
      'MMMMDDDDDMMMMDDD',
      'MDDMMMDDDMDDMMMD',
      'DDDMMDDDDDDDMMDD',
      '.MM..DDD..MM..DD',
      'MMMMDDDDDMMMMDDD',
      'MDDMMMDDDMDDMMMD',
      'DDDMMDDDDDDDMMDD',
      '.MM..DDD..MM..DD',
      'MMMMDDDDDMMMMDDD',
      'MDDMMMDDDMDDMMMD',
      'DDDMMDDDDDDDMMDD'
    ];
    const treePal = {
      'M': PALETTE.TREE_MAIN,
      'D': PALETTE.TREE_DARK,
      '.': 'transparent'
    };
    this.terrain.trees = bitmapToCanvas(treeRows, treePal);

    // 5. Ice 16x16
    const iceRows = [
      'WWWWWWWWWWWWWWWW',
      'WWSSWWWWWWWWSSWW',
      'WWSSWWWWWWWWSSWW',
      'WWWWWWSSWWWWWWWW',
      'WWWWWWSSWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWSSWWWWWWWWSSWW',
      'WWSSWWWWWWWWSSWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWSSWWWWWWWW',
      'WWWWWWSSWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWSSWWWWWWWWSSWW',
      'WWSSWWWWWWWWSSWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW'
    ];
    const icePal = {
      'W': PALETTE.ICE_MAIN,
      'S': PALETTE.ICE_SHADE
    };
    this.terrain.ice = bitmapToCanvas(iceRows, icePal);
  }

  buildEagle() {
    // Eagle Alive 16x16
    const eagleAliveRows = [
      '....WWWWWWWW....',
      '...WGGGGGGGGW...',
      '..WGGWWWWWWGGW..',
      '.WGWWGGGGGGWWGW.',
      'WGWWGGGGGGGGWWGW',
      'WGGGGWWGGWWGGGGW',
      'WGGGWWWWWWWWGGGW',
      'WGGGGWWGGWWGGGGW',
      'WGGGGGGGGGGGGGGW',
      'WGWWGGGGGGGGWWGW',
      '.WGGWWGGGGWWGGW.',
      '..WGGGWWWWGGGW..',
      '...WGGGGGGGGW...',
      '....WGGWWGGW....',
      '.....WGGGGW.....',
      '......WWWW......'
    ];
    const eaglePal = {
      'W': PALETTE.WHITE,
      'G': PALETTE.STEEL_DARK,
      '.': 'transparent'
    };
    this.eagle.alive = bitmapToCanvas(eagleAliveRows, eaglePal);

    // Eagle Destroyed (Ruins) 16x16
    const eagleRuinsRows = [
      '................',
      '....k......k....',
      '...kkk....kkk...',
      '....k..kk..k....',
      '..kkkkkDDkkkkk..',
      '.kDDDDDkkDDDDk..',
      '.kDDDDDDDDDDDDk.',
      'kDDDDDDkkDDDDDDk',
      'kDDDDkkkkkkDDDDk',
      'kDDkkDDDDDDkkDDk',
      'kDDDDDDDDDDDDDDk',
      'kkDDDDDDDDDDDDkk',
      '.kkDDDDDDDDDDkk.',
      '..kkkkDDDDkkkk..',
      '....kkkkkkkk....',
      '................'
    ];
    const ruinsPal = {
      'k': PALETTE.BLACK,
      'D': PALETTE.STEEL_DARK,
      '.': 'transparent'
    };
    this.eagle.destroyed = bitmapToCanvas(eagleRuinsRows, ruinsPal);
  }

  buildBullet() {
    // Bullet 4x4
    const bulletRows = [
      '.WW.',
      'WWWW',
      'WDDW',
      '.DD.'
    ];
    const bulletPal = {
      'W': PALETTE.WHITE,
      'D': PALETTE.STEEL_MAIN,
      '.': 'transparent'
    };
    this.bullet = bitmapToCanvas(bulletRows, bulletPal);
  }

  buildExplosions() {
    // Small explosion (3 frames: 8x8 -> 12x12 -> 16x16)
    const smallF0 = [
      '..WW..',
      '.WOOW.',
      'WOOORW',
      'WOROOW',
      '.WOOW.',
      '..WW..'
    ];
    const smallF1 = [
      '....WW....',
      '..WWOOWW..',
      '.WOOOOOOW.',
      '.WOORROOW.',
      'WWOORROOWW',
      'WWOORROOWW',
      '.WOORROOW.',
      '.WOOOOOOW.',
      '..WWOOWW..',
      '....WW....'
    ];
    const smallF2 = [
      '...W....W...',
      '..WWO..OWW..',
      '.WOOOOOOOOW.',
      'WWOORRRROOWW',
      '.OORRRRRROO.',
      '.OORRRRRROO.',
      'WWOORRRROOWW',
      '.WOOOOOOOOW.',
      '..WWO..OWW..',
      '...W....W...'
    ];
    const expPal = {
      'W': PALETTE.WHITE,
      'O': PALETTE.P1_LIGHT,
      'R': PALETTE.TEXT_RED,
      '.': 'transparent'
    };
    this.explosions.small = [
      bitmapToCanvas(smallF0, expPal),
      bitmapToCanvas(smallF1, expPal),
      bitmapToCanvas(smallF2, expPal)
    ];

    // Big explosion (3 frames: 16x16 -> 24x24 -> 32x32)
    // Canvas dimensions 32x32 for centering
    for (let f = 0; f < 3; f++) {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      const radii = [6, 11, 15];
      const r = radii[f];
      // Draw red burst
      ctx.fillStyle = PALETTE.TEXT_RED;
      ctx.beginPath();
      ctx.arc(16, 16, r, 0, Math.PI * 2);
      ctx.fill();

      // Orange center
      ctx.fillStyle = PALETTE.P1_LIGHT;
      ctx.beginPath();
      ctx.arc(16, 16, Math.max(1, r - 3), 0, Math.PI * 2);
      ctx.fill();

      // White core
      ctx.fillStyle = PALETTE.WHITE;
      ctx.beginPath();
      ctx.arc(16, 16, Math.max(1, r - 6), 0, Math.PI * 2);
      ctx.fill();

      this.explosions.big.push(c);
    }
  }

  buildSpawnStar() {
    // 4 sizes: S1 (6px), S2 (10px), S3 (14px), S4 (16px)
    const starSizes = [3, 5, 7, 8];
    this.stars = starSizes.map((rad) => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      ctx.fillStyle = PALETTE.WHITE;
      // Diamond star
      ctx.beginPath();
      ctx.moveTo(8, 8 - rad);
      ctx.lineTo(8 + Math.floor(rad / 3), 8);
      ctx.lineTo(8 + rad, 8);
      ctx.lineTo(8 + Math.floor(rad / 3), 8);
      ctx.lineTo(8, 8 + rad);
      ctx.lineTo(8 - Math.floor(rad / 3), 8);
      ctx.lineTo(8 - rad, 8);
      ctx.lineTo(8 - Math.floor(rad / 3), 8);
      ctx.closePath();
      ctx.fill();

      return c;
    });
  }

  buildShield() {
    // 2 alternating frames of dotted 18x18 ring
    for (let f = 0; f < 2; f++) {
      const c = document.createElement('canvas');
      c.width = 18;
      c.height = 18;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      ctx.fillStyle = f === 0 ? PALETTE.WHITE : PALETTE.WATER_A;
      // Dotted rectangular border
      for (let i = 0; i < 18; i += 2) {
        ctx.fillRect(i, 0, 1, 1);
        ctx.fillRect(17 - i, 17, 1, 1);
        ctx.fillRect(0, 17 - i, 1, 1);
        ctx.fillRect(17, i, 1, 1);
      }
      this.shields.push(c);
    }
  }

  buildPowerups() {
    // 16x16 powerup icons
    const makePowerup = (rows, pal) => {
      return bitmapToCanvas(rows, {
        'W': PALETTE.WHITE,
        'Y': PALETTE.P1_LIGHT,
        'O': PALETTE.P1_YELLOW,
        'R': PALETTE.TEXT_RED,
        'B': PALETTE.P3_BLUE,
        'G': PALETTE.TREE_MAIN,
        'D': PALETTE.STEEL_DARK,
        'k': PALETTE.BLACK,
        '.': 'transparent',
        ...pal
      });
    };

    // Star
    const starRows = [
      '.......YY.......',
      '......YYYY......',
      '......YYYY......',
      '..YYYYYYYYYYYY..',
      '...YYYYYYYYYY...',
      '....YYYYYYYY....',
      '....YYYYYYYY....',
      '...YYYYYYYYYY...',
      '..YYYY.YY.YYYY..',
      '..YYY..YY..YYY..',
      '..YY...YY...YY..',
      '.......YY.......',
      '................',
      '................',
      '................',
      '................'
    ];
    this.powerups.star = makePowerup(starRows, {});

    // Helmet
    const helmetRows = [
      '.....kkkkkk.....',
      '...kkBBBBBBkk...',
      '..kBBWWWWWWBBk..',
      '.kBBWWWWWWWWBBk.',
      '.kBBBBBBBBBBBBk.',
      '.kBBBBBBBBBBBBk.',
      '.kkkkkkkkkkkkkk.',
      '.kDDDDDDDDDDDDk.',
      '..kDDDDDDDDDDk..',
      '....kkkkkkkk....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................'
    ];
    this.powerups.helmet = makePowerup(helmetRows, {});

    // Clock
    const clockRows = [
      '.....kkkkkk.....',
      '...kkWWWWWWkk...',
      '..kWWWWkkWWWWk..',
      '.kWWWWWkkWWWWWk.',
      '.kWWWWWkkWWWWWk.',
      '.kWWkkkkkkkkWWk.',
      '.kWWWWWkkWWWWWk.',
      '.kWWWWWWWWWWWWk.',
      '..kWWWWWWWWWWk..',
      '...kkWWWWWWkk...',
      '.....kkkkkk.....',
      '................',
      '................',
      '................',
      '................',
      '................'
    ];
    this.powerups.clock = makePowerup(clockRows, {});

    // Shovel
    const shovelRows = [
      '.........kk.....',
      '........kDDk....',
      '.......kDDk.....',
      '......kDDk......',
      '.....kDDk.......',
      '....kDDk........',
      '...kYYk.........',
      '..kYYk..........',
      '.kYYk...........',
      'kkYkk...........',
      'kYYk............',
      '.kk.............',
      '................',
      '................',
      '................',
      '................'
    ];
    this.powerups.shovel = makePowerup(shovelRows, {});

    // Grenade
    const grenadeRows = [
      '.......kk.......',
      '......kRk.......',
      '.....kRRk.......',
      '....kGGGGk......',
      '...kGGGGGGk.....',
      '..kGGGGGGGGk....',
      '..kGGGGGGGGk....',
      '..kGGGGGGGGk....',
      '..kGGGGGGGGk....',
      '...kGGGGGGk.....',
      '....kGGGGk......',
      '.....kkkk.......',
      '................',
      '................',
      '................',
      '................'
    ];
    this.powerups.grenade = makePowerup(grenadeRows, {});

    // Tank (1UP)
    const tankRows = [
      '......YYYY......',
      '......YYYY......',
      '..YY..kYYk..YY..',
      '..YY.kYYYYk.YY..',
      '..YY.kYYYYk.YY..',
      '..YY.kYYYYk.YY..',
      '..YY.kYYYYk.YY..',
      '..YY.kYYYYk.YY..',
      '..YY..kkkk..YY..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................'
    ];
    this.powerups.tank = makePowerup(tankRows, {});
  }

  buildHUD() {
    // 8x8 Mini Tank silhouette for enemy reserves
    const miniTankEnemyRows = [
      '..kkkk..',
      '..k..k..',
      'kkk..kkk',
      'kkkkkkkk',
      'kkk..kkk',
      'kkk..kkk',
      'kkkkkkkk',
      '..kkkk..'
    ];
    this.hud.enemyIcon = bitmapToCanvas(miniTankEnemyRows, { 'k': PALETTE.BLACK });

    // 8x8 Mini Tank for Player 1 lives
    const miniTankP1Rows = [
      '..YYYY..',
      '..Y..Y..',
      'YYY..YYY',
      'YYYYYYYY',
      'YYY..YYY',
      'YYY..YYY',
      'YYYYYYYY',
      '..YYYY..'
    ];
    this.hud.p1LifeIcon = bitmapToCanvas(miniTankP1Rows, { 'Y': PALETTE.P1_YELLOW });

    // 8x8 Mini Tank for Player 2 lives
    const miniTankP2Rows = [
      '..GGGG..',
      '..G..G..',
      'GGG..GGG',
      'GGGGGGGG',
      'GGG..GGG',
      'GGG..GGG',
      'GGGGGGGG',
      '..GGGG..'
    ];
    this.hud.p2LifeIcon = bitmapToCanvas(miniTankP2Rows, { 'G': PALETTE.P2_GREEN });

    // 16x16 Stage Flag
    const flagRows = [
      '..kkkkkkk.......',
      '..kRRRRRk.......',
      '..kRRRRRk.......',
      '..kRRRRk........',
      '..kRRRRk........',
      '..kRRRk.........',
      '..kRRk..........',
      '..kRk...........',
      '..kk............',
      '..kk............',
      '..kk............',
      '..kk............',
      '..kk............',
      '..kk............',
      '..kk............',
      '.kkkk...........'
    ];
    this.hud.flag = bitmapToCanvas(flagRows, {
      'k': PALETTE.BLACK,
      'R': PALETTE.TEXT_RED,
      '.': 'transparent'
    });
  }

  // Pre-generate all tank sprites for each combination of:
  // type x treadFrame (0, 1) x dir (0=UP, 1=RIGHT, 2=DOWN, 3=LEFT)
  buildAllTanks() {
    const tankDefs = [
      {
        id: 'P1_s0',
        seed: TANK_SEED_BASIC,
        pal: {
          t1: PALETTE.P1_DARK,
          t2: PALETTE.P1_YELLOW,
          B: PALETTE.P1_YELLOW,
          b: PALETTE.P1_DARK,
          h: PALETTE.P1_LIGHT,
          G: PALETTE.P1_LIGHT,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'P1_s1',
        seed: TANK_SEED_BASIC,
        pal: {
          t1: PALETTE.P1_DARK,
          t2: PALETTE.P1_YELLOW,
          B: PALETTE.P1_YELLOW,
          b: PALETTE.P1_DARK,
          h: PALETTE.WHITE,
          G: PALETTE.WHITE,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'P1_s2',
        seed: TANK_SEED_POWER,
        pal: {
          t1: PALETTE.P1_DARK,
          t2: PALETTE.P1_YELLOW,
          B: PALETTE.P1_YELLOW,
          b: PALETTE.P1_DARK,
          h: PALETTE.WHITE,
          G: PALETTE.P1_LIGHT,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'P1_s3',
        seed: TANK_SEED_STAR3,
        pal: {
          t1: PALETTE.P1_DARK,
          t2: PALETTE.P1_YELLOW,
          B: PALETTE.P1_YELLOW,
          b: PALETTE.P1_DARK,
          h: PALETTE.WHITE,
          G: PALETTE.WHITE,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'P2_s0',
        seed: TANK_SEED_BASIC,
        pal: {
          t1: PALETTE.P2_DARK,
          t2: PALETTE.P2_GREEN,
          B: PALETTE.P2_GREEN,
          b: PALETTE.P2_DARK,
          h: PALETTE.P2_LIGHT,
          G: PALETTE.P2_LIGHT,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'basic',
        seed: TANK_SEED_BASIC,
        pal: {
          t1: PALETTE.ENEMY_DARK,
          t2: PALETTE.ENEMY_GRAY,
          B: PALETTE.ENEMY_GRAY,
          b: PALETTE.ENEMY_DARK,
          h: PALETTE.ENEMY_LIGHT,
          G: PALETTE.ENEMY_LIGHT,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'fast',
        seed: TANK_SEED_FAST,
        pal: {
          t1: PALETTE.ENEMY_DARK,
          t2: PALETTE.ENEMY_GRAY,
          B: PALETTE.ENEMY_GRAY,
          b: PALETTE.ENEMY_DARK,
          h: PALETTE.ENEMY_LIGHT,
          G: PALETTE.ENEMY_LIGHT,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'power',
        seed: TANK_SEED_POWER,
        pal: {
          t1: PALETTE.ENEMY_DARK,
          t2: PALETTE.ENEMY_GRAY,
          B: PALETTE.ENEMY_GRAY,
          b: PALETTE.ENEMY_DARK,
          h: PALETTE.ENEMY_LIGHT,
          G: PALETTE.ENEMY_LIGHT,
          k: PALETTE.BLACK
        }
      },
      // Armor tank HP variants (4: green, 3: yellow/gold, 2: light gray, 1: gray)
      {
        id: 'armor_hp4',
        seed: TANK_SEED_ARMOR,
        pal: {
          t1: PALETTE.P2_DARK,
          t2: PALETTE.P2_GREEN,
          B: PALETTE.P2_GREEN,
          b: PALETTE.P2_DARK,
          h: PALETTE.P2_LIGHT,
          G: PALETTE.P2_LIGHT,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'armor_hp3',
        seed: TANK_SEED_ARMOR,
        pal: {
          t1: PALETTE.P1_DARK,
          t2: PALETTE.P1_YELLOW,
          B: PALETTE.P1_YELLOW,
          b: PALETTE.P1_DARK,
          h: PALETTE.P1_LIGHT,
          G: PALETTE.P1_LIGHT,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'armor_hp2',
        seed: TANK_SEED_ARMOR,
        pal: {
          t1: PALETTE.ENEMY_DARK,
          t2: PALETTE.WHITE,
          B: PALETTE.WHITE,
          b: PALETTE.ENEMY_GRAY,
          h: PALETTE.WHITE,
          G: PALETTE.WHITE,
          k: PALETTE.BLACK
        }
      },
      {
        id: 'armor_hp1',
        seed: TANK_SEED_ARMOR,
        pal: {
          t1: PALETTE.ENEMY_DARK,
          t2: PALETTE.ENEMY_GRAY,
          B: PALETTE.ENEMY_GRAY,
          b: PALETTE.ENEMY_DARK,
          h: PALETTE.ENEMY_LIGHT,
          G: PALETTE.ENEMY_LIGHT,
          k: PALETTE.BLACK
        }
      },
      // Carrier flashing red variant
      {
        id: 'carrier_red',
        seed: TANK_SEED_BASIC,
        pal: {
          t1: PALETTE.ENEMY_RED_DARK,
          t2: PALETTE.ENEMY_RED,
          B: PALETTE.ENEMY_RED,
          b: PALETTE.ENEMY_RED_DARK,
          h: PALETTE.ENEMY_RED_LIGHT,
          G: PALETTE.ENEMY_RED_LIGHT,
          k: PALETTE.BLACK
        }
      }
    ];

    tankDefs.forEach((def) => {
      // Tread frame 0: x=t1, y=t2
      // Tread frame 1: x=t2, y=t1 (swap tread colors to animate)
      for (let tread = 0; tread < 2; tread++) {
        const pal = {
          'x': tread === 0 ? def.pal.t1 : def.pal.t2,
          'y': tread === 0 ? def.pal.t2 : def.pal.t1,
          'B': def.pal.B,
          'b': def.pal.b,
          'h': def.pal.h,
          'G': def.pal.G,
          'k': def.pal.k,
          '.': 'transparent'
        };

        const upCanvas = bitmapToCanvas(def.seed, pal);

        // 4 directions: 0=UP, 1=RIGHT, 2=DOWN, 3=LEFT
        for (let dir = 0; dir < 4; dir++) {
          const key = `${def.id}_${tread}_${dir}`;
          this.tanks[key] = rotateCanvas(upCanvas, dir);
        }
      }
    });
  }

  getTank(id, treadFrame, dir) {
    const key = `${id}_${treadFrame % 2}_${dir}`;
    return this.tanks[key] || this.tanks[`basic_0_0`];
  }
}
