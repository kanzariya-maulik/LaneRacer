// shared/constants.js
// Single source of truth for all constants, dimensions, golden numbers, and palette.

export const CANVAS_W = 256;
export const CANVAS_H = 240;

export const PLAYFIELD_X = 16;
export const PLAYFIELD_Y = 8;
export const PLAYFIELD_W = 208;
export const PLAYFIELD_H = 208;

export const TILE_SIZE = 16;
export const CELL_SIZE = 8;
export const QUARTER_SIZE = 4;
export const GRID_TILES_X = 13;
export const GRID_TILES_Y = 13;
export const GRID_CELLS_X = 26;
export const GRID_CELLS_Y = 26;

// Fixed-point representation: 1/16 px
export const FP_SHIFT = 4;
export const FP_ONE = 1 << FP_SHIFT; // 16

// Tank bounding box
export const TANK_SIZE = 16;
export const BULLET_SIZE = 4;

// Directions
export const DIR_UP = 0;
export const DIR_RIGHT = 1;
export const DIR_DOWN = 2;
export const DIR_LEFT = 3;
export const DIR_NONE = -1;

export const DIR_OFFSETS = [
  { dx: 0, dy: -1 }, // UP
  { dx: 1, dy: 0 },  // RIGHT
  { dx: 0, dy: 1 },  // DOWN
  { dx: -1, dy: 0 }  // LEFT
];

// Speeds in px/frame [APPROX / TUNE]
export const SPEED_PLAYER = 0.75;
export const SPEED_BASIC = 0.50;
export const SPEED_FAST = 1.00;
export const SPEED_POWER = 0.50;
export const SPEED_ARMOR = 0.50;

// Speeds in 1/16 px units for deterministic integer sim
export const FP_SPEED_PLAYER = 12; // 0.75 * 16
export const FP_SPEED_BASIC = 8;   // 0.50 * 16
export const FP_SPEED_FAST = 16;   // 1.00 * 16
export const FP_SPEED_POWER = 8;
export const FP_SPEED_ARMOR = 8;

export const BULLET_SPEED_SLOW = 3;
export const BULLET_SPEED_FAST = 6;
export const FP_BULLET_SPEED_SLOW = 48; // 3 * 16
export const FP_BULLET_SPEED_FAST = 96; // 6 * 16

// Bullet limits
export const BULLETS_MAX_PLAYER_DEFAULT = 1;
export const BULLETS_MAX_PLAYER_UPGRADED = 2;
export const BULLETS_MAX_ENEMY = 1;

// Armor HP
export const ARMOR_HP = 4;

// Durations in frames @ 60 Hz [EXACT / APPROX]
export const SPAWN_STAR_FRAMES = 60;
export const SPAWN_SHIELD_FRAMES = 180; // 3 s
export const HELMET_SHIELD_FRAMES = 600; // 10 s
export const CLOCK_FREEZE_FRAMES = 600; // 10 s
export const SHOVEL_FRAMES = 1200; // 20 s
export const SHOVEL_FLASH_FRAMES = 180; // ~3 s
export const FRIENDLY_FREEZE_FRAMES = 150; // ~2.5 s
export const ICE_SLIDE_FRAMES = 20;
export const RESPAWN_DELAY_FRAMES = 60;
export const STAGE_CLEAR_WAIT_FRAMES = 190;
export const POPUP_SCORE_FRAMES = 40;
export const TREAD_TOGGLE_TICKS = 2;
export const WATER_ANIM_TICKS = 32;

// Enemies & Waves [EXACT / APPROX]
export const ENEMIES_PER_STAGE = 20;
export const MAX_ALIVE_1P = 4;
export const MAX_ALIVE_2P = 6;
export const MAX_ALIVE_LAN_CAP = 8;
export const CARRIER_INDICES = [3, 10, 17]; // 4th, 11th, 18th enemy

// Enemy spawn delay formula: 190 - (stage - 1)*4 - (players - 1)*20
export const BASE_SPAWN_DELAY = 190;
export const MIN_SPAWN_DELAY = 60;

// Spawns in pixel coordinates
export const ENEMY_SPAWN_TILES = [
  { tx: 0, ty: 0, x: 0, y: 0 },
  { tx: 6, ty: 0, x: 96, y: 0 },
  { tx: 12, ty: 0, x: 192, y: 0 }
];

export const EAGLE_POS = { tx: 6, ty: 12, x: 96, y: 192 };
export const P1_SPAWN_POS = { tx: 4, ty: 12, x: 64, y: 192 };
export const P2_SPAWN_POS = { tx: 8, ty: 12, x: 128, y: 192 };
export const P3_SPAWN_POS = { tx: 2, ty: 12, x: 32, y: 192 };
export const P4_SPAWN_POS = { tx: 10, ty: 12, x: 160, y: 192 };

// Terrain codes
export const TILE_EMPTY = 0;
export const TILE_BRICK = 1;
export const TILE_STEEL = 2;
export const TILE_WATER = 3;
export const TILE_TREES = 4;
export const TILE_ICE = 5;
export const TILE_EAGLE = 6;

// Brick quarters bitmask (4 bits per cell):
// bit0: top-left (0b0001)
// bit1: top-right (0b0010)
// bit2: bottom-left (0b0100)
// bit3: bottom-right (0b1000)
export const BRICK_FULL = 0b1111;
export const BRICK_TL = 0b0001;
export const BRICK_TR = 0b0010;
export const BRICK_BL = 0b0100;
export const BRICK_BR = 0b1000;

// Powerup types
export const POWERUP_STAR = 'star';
export const POWERUP_HELMET = 'helmet';
export const POWERUP_CLOCK = 'clock';
export const POWERUP_SHOVEL = 'shovel';
export const POWERUP_GRENADE = 'grenade';
export const POWERUP_TANK = 'tank';
export const POWERUP_TYPES = [
  POWERUP_STAR,
  POWERUP_HELMET,
  POWERUP_CLOCK,
  POWERUP_SHOVEL,
  POWERUP_GRENADE,
  POWERUP_TANK
];

// Scores
export const SCORE_BASIC = 100;
export const SCORE_FAST = 200;
export const SCORE_POWER = 300;
export const SCORE_ARMOR = 400;
export const SCORE_PICKUP = 500;
export const EXTRA_LIFE_INTERVAL = 20000;
export const INITIAL_RESERVES = 3;

// Palette [APPROX — NES-like per file 02 §3]
export const PALETTE = {
  GRAY_BG: '#636363',
  BLACK: '#000000',
  WHITE: '#FCFCFC',
  BRICK_MAIN: '#B53121',
  BRICK_LIGHT: '#E7745A',
  BRICK_DARK: '#000000',
  STEEL_MAIN: '#BCBCBC',
  STEEL_LIGHT: '#FCFCFC',
  STEEL_DARK: '#747474',
  WATER_A: '#3CBCFC',
  WATER_B: '#0058F8',
  TREE_MAIN: '#00A800',
  TREE_DARK: '#005800',
  ICE_MAIN: '#FCFCFC',
  ICE_SHADE: '#BCBCBC',
  P1_YELLOW: '#E4A000',
  P1_LIGHT: '#FCD848',
  P1_DARK: '#885800',
  P2_GREEN: '#00A800',
  P2_LIGHT: '#80D010',
  P2_DARK: '#005800',
  P3_BLUE: '#0058F8',
  P3_LIGHT: '#3CBCFC',
  P3_DARK: '#001088',
  P4_PURPLE: '#B800B8',
  P4_LIGHT: '#F878F8',
  P4_DARK: '#580058',
  ENEMY_GRAY: '#BCBCBC',
  ENEMY_LIGHT: '#FCFCFC',
  ENEMY_DARK: '#747474',
  ENEMY_RED: '#D82800',
  ENEMY_RED_LIGHT: '#FC7460',
  ENEMY_RED_DARK: '#881400',
  TEXT_ORANGE: '#E4A000',
  TEXT_RED: '#D82800'
};
