# Paint one texture per livery from the baked lookup maps, plus thumbnails and preview renders.
# Run: npm run build:liveries   (after npm run build:car)
import bpy, os, sys
import numpy as np
from math import radians

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from car_parts import PARTS

ROOT = os.path.dirname(HERE)
LIVERY_DIR = os.path.join(ROOT, 'public', 'liveries')
RENDER_DIR = os.path.join(ROOT, 'refs', 'renders')
os.makedirs(LIVERY_DIR, exist_ok=True)
os.makedirs(RENDER_DIR, exist_ok=True)

BAKE = np.load(os.path.join(HERE, 'build', 'bake.npz'))
CARBON = '#1b1b1b'
WINGS = ('fw_main', 'fw_flap', 'rw_main', 'rw_flap')


def rgb(hex_color):
    h = hex_color.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def band(a, lo, hi):
    return (a >= lo) & (a <= hi)


class Livery:
    """Texel-space canvas. x forward, y left, z up (metres); masks select texels."""
    def __init__(self):
        p, n = BAKE['pos'], BAKE['nrm']
        self.x, self.y, self.z = p[..., 0], p[..., 1], p[..., 2]
        self.side = np.abs(n[..., 1]) > 0.5
        self.top = n[..., 2] > 0.5
        self.part = BAKE['part']
        self.rgb = np.zeros(self.x.shape + (3,), np.float32)

    def is_(self, *names):
        return np.isin(self.part, [PARTS[n] for n in names])

    def fill(self, color, where=None):
        if where is None:
            self.rgb[...] = rgb(color)
        else:
            self.rgb[where] = rgb(color)


def common(L, body, wings=CARBON, halo=CARBON):
    L.fill(body)
    L.fill(CARBON, L.is_('floor', 'rw_pillar'))
    L.fill(wings, L.is_(*WINGS))
    L.fill(halo, L.is_('halo'))


BODYWORK = ('chassis', 'nose', 'sidepods', 'engine')


# Rules tuned against refs/<team>-1.jpg (2023 launch photos, F1.com)
def redbull(L):
    NAVY, RED, YELLOW = '#1b2a4a', '#d7182a', '#ffcc00'
    common(L, NAVY)
    L.fill(RED, L.is_('nose') & (L.x > 2.35))
    L.fill(RED, L.is_('engine') & L.side & band(L.x, -1.3, -0.4) & (L.z > 0.32))   # charging bull
    L.fill(YELLOW, L.is_('engine') & L.side & (((L.x + 0.85) ** 2 + (L.z - 0.5) ** 2) < 0.09 ** 2))  # sun
    L.fill(RED, L.is_('fw_end') & (L.z > 0.2))
    L.fill(YELLOW, L.is_('helmet'))


def mercedes(L):
    BLACK, TEAL = '#101010', '#00d2be'
    common(L, BLACK)
    L.fill(TEAL, L.is_('sidepods', 'engine') & L.side & (np.abs(L.z - (0.30 + 0.08 * (L.x + 0.5))) < 0.02))
    L.fill(TEAL, L.is_('chassis', 'nose') & L.side & (np.abs(L.z - 0.30) < 0.015))
    L.fill(TEAL, L.is_('fw_flap') & band(np.abs(L.y), 0.3, 0.6))
    L.fill(TEAL, L.is_('rw_end') & band(L.z, 0.6, 0.65))
    L.fill('#f5e100', L.is_('helmet'))


def ferrari(L):
    RED, WHITE = '#d40000', '#f5f5f5'
    common(L, RED, wings=RED)
    L.fill(CARBON, L.is_('fw_main'))
    L.fill(CARBON, L.is_('engine', 'fin') & L.top & (L.x < -0.9))      # bare carbon engine cover top
    L.fill(CARBON, L.is_('sidepods') & (L.z < 0.2))
    L.fill(WHITE, L.is_('fw_end') & band(L.z, 0.15, 0.2))
    L.fill('#ffd200', L.is_('helmet'))


def mclaren(L):
    PAPAYA, BLUE, ANTHRACITE = '#ff8000', '#47c7fc', '#2b2b2b'
    common(L, PAPAYA, wings=ANTHRACITE)
    L.fill(ANTHRACITE, L.is_(*BODYWORK) & L.side & (L.z < 0.42))
    L.fill(BLUE, L.is_('sidepods', 'chassis', 'nose') & L.side & band(L.z, 0.42, 0.46))
    L.fill(PAPAYA, L.is_('rw_main', 'rw_flap', 'fw_end'))
    L.fill(BLUE, L.is_('fw_end') & (L.z < 0.1))
    L.fill('#f5e100', L.is_('helmet'))


def astonmartin(L):
    GREEN, LIME, BLACK = '#00665e', '#cedc00', '#0d0d0d'
    common(L, GREEN)
    L.fill(BLACK, L.is_(*BODYWORK) & L.side & (L.z < 0.30))
    L.fill(LIME, L.is_(*BODYWORK) & L.side & band(L.z, 0.30, 0.32))
    L.fill(BLACK, L.is_('fw_end', 'rw_end', 'fin'))
    L.fill(LIME, L.is_('helmet'))


def alpine(L):
    BLUE, PINK, BLACK = '#0a6fd1', '#f59ad6', '#111111'
    common(L, BLUE)
    L.fill(PINK, L.is_('sidepods') & L.side & (L.z > 0.18))
    L.fill(PINK, L.is_('engine') & L.side & (L.x < -0.9))
    L.fill(BLACK, L.is_('sidepods', 'chassis') & L.side & (L.z < 0.18))
    L.fill(PINK, L.is_('rw_main', 'rw_flap', 'fw_flap'))
    L.fill(BLACK, L.is_('rw_end'))
    L.fill(BLUE, L.is_('helmet'))


def williams(L):
    BLUE, CYAN, BLACK, RED = '#0b2a8a', '#37bdf8', '#0d0d1a', '#e0242f'
    common(L, BLUE)
    L.fill(BLACK, L.is_(*BODYWORK) & L.side & (L.z < 0.28))
    L.fill(CYAN, L.is_('sidepods', 'engine') & L.side & (np.abs(L.z - (0.32 + 0.1 * (L.x + 0.2))) < 0.012))
    L.fill(RED, L.is_('nose') & L.side & (np.abs(L.z - 0.26) < 0.01))
    L.fill(BLUE, L.is_('rw_end', 'fw_end'))
    L.fill(CYAN, L.is_('helmet'))


def alphatauri(L):
    NAVY, WHITE, RED = '#1b2b45', '#f2f2f2', '#d71921'
    common(L, NAVY, halo=RED)
    L.fill(WHITE, L.is_('nose'))
    L.fill(WHITE, L.is_('chassis') & (L.x > 0.6))
    L.fill(WHITE, L.is_('engine', 'fin') & band(L.x, -1.1, -0.1) & (L.z > 0.6))   # white flash behind airbox
    L.fill(RED, L.is_('rw_main', 'rw_flap'))
    L.fill(RED, L.is_('sidepods') & L.side & band(L.z, 0.12, 0.17))
    L.fill(WHITE, L.is_('helmet'))


def alfaromeo(L):
    RED, BLACK = '#b3001b', '#151515'
    common(L, BLACK)
    L.fill(RED, L.is_('nose', 'chassis') & (L.top | (L.z > 0.4)))
    L.fill(RED, L.is_('engine', 'fin') & (L.top | (L.z > 0.5)))
    L.fill(BLACK, L.is_('fw_end', 'rw_end'))
    L.fill(RED, L.is_('helmet'))


def haas(L):
    BLACK, WHITE, RED = '#111111', '#f2f2f2', '#e10600'
    common(L, BLACK, halo=WHITE)
    L.fill(WHITE, L.is_('nose', 'chassis') & (L.top | (L.z > 0.36)))
    L.fill(WHITE, L.is_('sidepods') & L.side & (np.abs(L.z - 0.4) < 0.015))
    L.fill(RED, L.is_('engine') & L.side & (((L.x + 0.7) ** 2 + (L.z - 0.55) ** 2) < 0.1 ** 2))  # red disc
    L.fill(RED, L.is_('rw_main', 'rw_flap'))
    L.fill(RED, L.is_('fw_flap') & band(np.abs(L.y), 0.4, 0.9))
    L.fill(WHITE, L.is_('helmet'))


def redbull_suzuka(L):
    # 2025 RB21 Japanese GP, Honda RA272 tribute (refs/rb-suzuka-*.jpg)
    WHITE, RED = '#f4f4f4', '#d1001c'
    common(L, WHITE)
    L.fill(RED, L.is_('engine') & L.top & band(L.x, -1.4, -0.25))                 # red block behind the airbox
    L.fill(RED, L.is_('engine') & L.side & band(L.x, -1.3, -0.4) & (L.z > 0.45))  # sweeping down the sides
    L.fill(RED, L.is_('nose') & L.top & (((L.x - 2.0) ** 2 + L.y ** 2) < 0.11 ** 2))  # flag disc
    L.fill(RED, L.is_('chassis', 'nose') & L.side & (np.abs(L.z - 0.40) < 0.01))   # pinstripe
    L.fill(CARBON, L.is_('sidepods') & (L.z < 0.3))
    L.fill(RED, L.is_('fw_main', 'fw_flap') & band(np.abs(L.y), 0.35, 0.7))       # red wing flashes
    L.fill(CARBON, L.is_('rw_end', 'fw_end'))
    L.fill(WHITE, L.is_('helmet'))


LIVERIES = {
    'redbull': redbull, 'mercedes': mercedes, 'ferrari': ferrari, 'mclaren': mclaren,
    'astonmartin': astonmartin, 'alpine': alpine, 'williams': williams, 'alphatauri': alphatauri,
    'alfaromeo': alfaromeo, 'haas': haas, 'redbull-suzuka': redbull_suzuka,
}


def dilate(rgb_arr, mask, steps=6):
    """Grow painted texels into the unpainted gutter so UV seams don't sample black."""
    out, filled = rgb_arr.copy(), mask.copy()
    for _ in range(steps):
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src = np.roll(out, (dy, dx), axis=(0, 1))
            took = ~filled & np.roll(filled, (dy, dx), axis=(0, 1))
            out[took] = src[took]
            filled |= took
    out[~filled] = out[mask].mean(axis=0)
    return out


def save_png(rgb_arr, path):
    h, w = rgb_arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    rgba = np.concatenate([rgb_arr, np.ones((h, w, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


# ---------- preview scene ----------
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.view_settings.view_transform = 'Standard'  # AgX would desaturate team colours
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

world = bpy.data.worlds.new('preview')
scene.world = world
try:
    world.use_nodes = True
except AttributeError:
    pass
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0.8, 0.8, 0.82, 1)

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (radians(50), 0, radians(30))
scene.collection.objects.link(sun)

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
aim = bpy.data.objects.new('aim', None)
aim.location = (0, 0, 0.4)
scene.collection.objects.link(aim)

TEX_NODE = bpy.data.materials['livery'].node_tree.nodes['LiveryTex']


def render(path, view, w, h, transparent=False):
    cam.constraints.clear()
    if view == '34':
        cam.data.type = 'PERSP'
        cam.data.lens = 50
        cam.location = (5.5, -5.5, 3.0)
        c = cam.constraints.new('TRACK_TO')
        c.target = aim
        c.track_axis = 'TRACK_NEGATIVE_Z'
        c.up_axis = 'UP_Y'
    else:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = 6.4
        cam.location = (0, -9, 0.6) if view == 'side' else (0, 0, 9)
        cam.rotation_euler = (radians(90), 0, 0) if view == 'side' else (0, 0, 0)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.film_transparent = transparent
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


only = os.environ.get('LIVERY')  # LIVERY=ferrari npm run build:liveries → repaint one team while tuning
for team_id, paint in LIVERIES.items():
    if only and team_id != only:
        continue
    L = Livery()
    paint(L)
    TEX_NODE.image = save_png(dilate(L.rgb, BAKE['mask']), os.path.join(LIVERY_DIR, f'{team_id}.png'))
    render(os.path.join(LIVERY_DIR, f'{team_id}-thumb.png'), 'side', 320, 120, transparent=True)
    for view in ('side', 'top', '34'):
        render(os.path.join(RENDER_DIR, f'{team_id}-{view}.png'), view, 1280, 720)
    print(f'painted {team_id}')
