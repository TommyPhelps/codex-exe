"""Draws the CODEX.EXE icon (a leather-bound journal with a gold compass star)
and writes Tauri's icon set. Original artwork; no game assets.

Usage: python3 tools/make_icons.py src-tauri/icons
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 1024
LEATHER_TOP, LEATHER_BOT = (122, 62, 36), (58, 28, 16)
GOLD, GOLD_DARK = (222, 178, 92), (140, 98, 40)
PAGE = (238, 222, 184)


def star(cx, cy, r_out, r_in, points=8, rot=-math.pi / 2):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / points
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw(size):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # soft shadow
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([150, 110, 900, 960], 46, fill=(0, 0, 0, 150))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)))

    d = ImageDraw.Draw(im)
    # page block peeking out on the right
    d.rounded_rectangle([170, 96, 892, 930], 30, fill=PAGE)
    for i in range(6):
        d.line([(870 - i * 6, 120), (870 - i * 6, 906)], fill=(205, 186, 146), width=2)

    # leather cover with vertical gradient
    cover = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cover)
    x0, y0, x1, y1 = 124, 72, 852, 952
    for y in range(y0, y1):
        t = (y - y0) / (y1 - y0)
        c = tuple(int(a + (b - a) * t) for a, b in zip(LEATHER_TOP, LEATHER_BOT)) + (255,)
        cd.line([(x0, y), (x1, y)], fill=c)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x1, y1], 40, fill=255)
    im.paste(cover, (0, 0), mask)

    d = ImageDraw.Draw(im)
    # spine band
    d.rounded_rectangle([x0, y0, x0 + 92, y1], 40, fill=(44, 20, 11, 255))
    for yy in (230, 512, 794):
        d.rectangle([x0 + 8, yy - 14, x0 + 84, yy + 14], fill=GOLD_DARK)
        d.rectangle([x0 + 8, yy - 6, x0 + 84, yy + 6], fill=GOLD)

    # tooled border
    bx0, by0, bx1, by1 = x0 + 140, y0 + 70, x1 - 60, y1 - 70
    d.rounded_rectangle([bx0, by0, bx1, by1], 18, outline=GOLD_DARK, width=10)
    d.rounded_rectangle([bx0 + 22, by0 + 22, bx1 - 22, by1 - 22], 10, outline=GOLD, width=5)
    # corner ornaments
    for cx, cy in ((bx0, by0), (bx1, by0), (bx0, by1), (bx1, by1)):
        d.polygon(star(cx, cy, 44, 16, 4, 0), fill=GOLD)

    # compass star emblem
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    d.ellipse([cx - 190, cy - 190, cx + 190, cy + 190], outline=GOLD_DARK, width=14)
    d.ellipse([cx - 160, cy - 160, cx + 160, cy + 160], outline=GOLD, width=6)
    d.polygon(star(cx, cy, 250, 46, 4), fill=GOLD)
    d.polygon(star(cx, cy, 150, 36, 4, -math.pi / 2 + math.pi / 4), fill=GOLD_DARK)
    # shading on half of each long point
    for i in range(4):
        a = -math.pi / 2 + i * math.pi / 2
        tip = (cx + 250 * math.cos(a), cy + 250 * math.sin(a))
        side = (cx + 46 * math.cos(a + math.pi / 4), cy + 46 * math.sin(a + math.pi / 4))
        d.polygon([(cx, cy), tip, side], fill=(176, 132, 58))
    d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=(58, 28, 16), outline=GOLD, width=8)

    # ribbon bookmark
    d.polygon([(700, 930), (760, 930), (760, 1004), (730, 980), (700, 1004)], fill=(150, 28, 26))
    return im.resize((size, size), Image.LANCZOS)


out = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/icons"
import os

os.makedirs(out, exist_ok=True)
draw(32).save(f"{out}/32x32.png")
draw(128).save(f"{out}/128x128.png")
draw(256).save(f"{out}/128x128@2x.png")
big = draw(512)
big.save(f"{out}/icon.png")
draw(256).save(f"{out}/icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons written to", out)
