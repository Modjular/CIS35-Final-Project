#!/usr/bin/env python3
"""extract_atlas.py — one-off: build assets/ + atlas.json from the in-repo Unity art.

Parses the sprite-slice rects out of each `.png.meta` (Unity stores them under
`spriteSheet.sprites` with bottom-left-origin rects), converts them to canvas
top-left origin, copies the needed PNGs into assets/sprites/ (renamed to stable
logical names), and writes assets/atlas.json describing every image + its frames.

The (team, unit, state) -> logical-image mapping and animation playback live in
JS (src/render/sprites.js); this tool only produces pure image + frame data.

Run from the repo root:  python3 tools/extract_atlas.py
"""
import json, os, re, struct, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = os.path.join(ROOT, "Assets", "Sprites")
OUT_DIR = os.path.join(ROOT, "assets")
OUT_SPRITES = os.path.join(OUT_DIR, "sprites")
OUT_AUDIO = os.path.join(OUT_DIR, "audio")

# logical name -> (source png relative to Assets/Sprites, sliced?)
# sliced=True  -> read ordered frame rects from the .png.meta
# sliced=False -> single frame == whole image
IMAGES = {
    # Green Earth (green team) — complete for inf/tank/mtank.
    "ge_inf_move":   ("Units-GreenEarth/GEInfantryMove.png",  True),
    "ge_inf_fire":   ("Units-GreenEarth/GEInfantryFiring.png", True),
    "ge_tank_move":  ("Units-GreenEarth/GETankMove.png",      True),
    "ge_tank_fire":  ("Units-GreenEarth/GETankFire.png",      True),
    "ge_mtank_move": ("Units-GreenEarth/GEMdTankMove.png",    True),
    "ge_mtank_fire": ("Units-GreenEarth/GEMdTankFiring.png",  True),
    # Orange Star (red team) — good fire anims; move mostly single-frame.
    "os_inf_move":   ("Units-OrangeStar/RedInfantryMoving.png", True),
    "os_inf_fire":   ("Units-OrangeStar/OSInfantryFire.png",    True),
    "os_tank_move":  ("Units-OrangeStar/TANK-red.png",          False),
    "os_tank_fire":  ("Units-OrangeStar/OSTankFire.png",        True),
    "os_mtank_fire": ("Units-OrangeStar/OSMdTankFire.png",      True),
    "os_recon_move": ("Units-OrangeStar/recon.png",             False),
    "os_recon_fire": ("Units-OrangeStar/OSReconFire.png",       True),
    # HQ towers (static single sprites).
    "hq_red":        ("Units-OrangeStar/OrangeStartHQ.png", False),
    "hq_green":      ("Units-GreenEarth/GreenEarthHQ.png",  False),
    # Explosion one-shot + field map.
    "explosion":     ("Explosion.png",       True),
    "map":           ("Maps/map1_waterV2.png", False),
}

def png_size(path):
    with open(path, "rb") as f:
        f.read(16)
        return struct.unpack(">II", f.read(8))

def parse_frames(meta_path, sheet_h):
    """Return frames ordered by their trailing _N index, in top-left px coords."""
    text = open(meta_path, encoding="utf-8", errors="ignore").read()
    if "spriteSheet:" not in text:
        return []
    block = text.split("spriteSheet:", 1)[1]
    # Each sprite: a `name:` followed later by a `rect:` with x/y/width/height.
    entries = []
    # Split on "- serializedVersion: 2" sprite boundaries under sprites:.
    for chunk in re.split(r"\n    - serializedVersion:", block):
        nm = re.search(r"name:\s*(\S+)", chunk)
        rc = re.search(r"rect:\s*\n\s*serializedVersion:\s*\d+\s*\n"
                       r"\s*x:\s*([-\d.]+)\s*\n\s*y:\s*([-\d.]+)\s*\n"
                       r"\s*width:\s*([-\d.]+)\s*\n\s*height:\s*([-\d.]+)", chunk)
        if not nm or not rc:
            continue
        name = nm.group(1)
        x, y, w, h = (float(rc.group(i)) for i in range(1, 5))
        idx = re.search(r"_(\d+)$", name)
        order = int(idx.group(1)) if idx else 0
        # Unity rect y is bottom-left; convert to canvas top-left.
        entries.append((order, {"x": round(x), "y": round(sheet_h - y - h),
                                 "w": round(w), "h": round(h)}))
    entries.sort(key=lambda e: e[0])
    return [e[1] for e in entries]

def main():
    os.makedirs(OUT_SPRITES, exist_ok=True)
    os.makedirs(OUT_AUDIO, exist_ok=True)

    atlas = {"pixelsPerUnit": 100, "fps": 12, "images": {}}
    for name, (rel, sliced) in IMAGES.items():
        src = os.path.join(SPRITES, rel)
        if not os.path.exists(src):
            print(f"  WARN missing {rel}", file=sys.stderr)
            continue
        w, h = png_size(src)
        out_name = name + ".png"
        shutil.copyfile(src, os.path.join(OUT_SPRITES, out_name))
        if sliced:
            frames = parse_frames(src + ".meta", h)
            if not frames:
                print(f"  WARN no frames parsed for {rel}; using whole image", file=sys.stderr)
                frames = [{"x": 0, "y": 0, "w": w, "h": h}]
        else:
            frames = [{"x": 0, "y": 0, "w": w, "h": h}]
        atlas["images"][name] = {"file": out_name, "w": w, "h": h, "frames": frames}
        print(f"  {name:14s} {len(frames):2d} frame(s)  {w}x{h}")

    with open(os.path.join(OUT_DIR, "atlas.json"), "w") as f:
        json.dump(atlas, f, indent=1)
    print(f"Wrote {os.path.join(OUT_DIR, 'atlas.json')} "
          f"({len(atlas['images'])} images)")

    # Copy the sound effects we use (renamed to logical names).
    sounds = {
        "shot": "shot.wav", "heavy_shot": "heavy shot.wav", "damage": "damage.wav",
        "placement": "placement.wav", "error": "song104-error.wav", "death": "death.mp3",
    }
    src_snd = os.path.join(ROOT, "Assets", "Sounds")
    for logical, fn in sounds.items():
        src = os.path.join(src_snd, fn)
        if os.path.exists(src):
            ext = os.path.splitext(fn)[1]
            shutil.copyfile(src, os.path.join(OUT_AUDIO, logical + ext))
            print(f"  audio {logical}{ext}")
        else:
            print(f"  WARN missing sound {fn}", file=sys.stderr)

if __name__ == "__main__":
    main()
