# Shared by build-car.py and paint-liveries.py
PARTS = {
    'floor': 1, 'chassis': 2, 'nose': 3, 'sidepods': 4, 'engine': 5, 'fin': 6,
    'halo': 7, 'helmet': 8, 'fw_main': 9, 'fw_flap': 10, 'fw_end': 11,
    'rw_main': 12, 'rw_flap': 13, 'rw_end': 14, 'rw_pillar': 15,
}
TEX_SIZE = 1024
WHEEL_RADIUS = 0.36      # public/js/game3d.js WHEEL_RADIUS_M must match
POS_RANGE = 4.0          # bake encodes positions in [-4, 4] m
