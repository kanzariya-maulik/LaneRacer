# Downloads the car models listed in scripts/cars/models.json from Sketchfab (glTF archives) into
# scripts/build/cars/<uid>/, using the API key the user stored in Blender's "MCP for Blender" add-on.
# The key is only ever sent to api.sketchfab.com: never printed, logged or written anywhere.
#   blender -b --python scripts/cars/fetch.py -- all | <uid> [<uid> ...]
import bpy, json, os, sys, zipfile, io, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'scripts', 'build', 'cars')


def api_key():
    for name, addon in bpy.context.preferences.addons.items():
        key = getattr(getattr(addon, 'preferences', None), 'sketchfab_api_key', '')
        if key:
            return key
    sys.exit('No Sketchfab API key in Blender (MCP for Blender add-on preferences)')


def fetch(uid, key):
    dest = os.path.join(OUT, uid)
    if os.path.isdir(dest) and any(f.endswith('.gltf') for _, _, fs in os.walk(dest) for f in fs):
        print(f'{uid}: already here')
        return True
    req = urllib.request.Request(f'https://api.sketchfab.com/v3/models/{uid}/download', headers={'Authorization': f'Token {key}'})
    try:
        links = json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        print(f'{uid}: download not available ({e.code})')
        return False
    url = (links.get('gltf') or {}).get('url')
    if not url:
        print(f'{uid}: no glTF archive offered')
        return False
    data = urllib.request.urlopen(url, timeout=600).read()  # a signed storage link: no key sent with it
    os.makedirs(dest, exist_ok=True)
    zipfile.ZipFile(io.BytesIO(data)).extractall(dest)
    print(f'{uid}: {len(data) / 1e6:.1f} MB')
    return True


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['all']
    models = json.load(open(os.path.join(ROOT, 'scripts', 'cars', 'models.json')))
    uids = sorted({m['uid'] for m in [*models['cars'].values(), models['tyre'], models['helmet']]}) if args == ['all'] else args
    key = api_key()
    failed = [u for u in uids if not fetch(u, key)]
    print('failed:', ', '.join(failed) if failed else 'none')


main()
