"""產生 PWA 圖示（發光鍋貼）。

用法：
  python3 tools/make_icons.py                 # 用程式繪製的暫時鍋貼圖
  python3 tools/make_icons.py 鍋貼照片.jpg    # 用真實鍋貼照片製作發光圖示
輸出到 icons/：icon-192.png、icon-512.png、icon-maskable-512.png、
apple-touch-icon.png（180）、favicon-32.png
"""
import sys, math, os
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageChops

S = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')


def radial_bg(size, inner=(96, 62, 38), outer=(36, 24, 17)):
    img = Image.new('RGB', (size, size))
    px = img.load()
    c = size / 2
    for y in range(size):
        for x in range(size):
            t = min(1, math.hypot(x - c, y - c) / (size * 0.72))
            px[x, y] = tuple(int(inner[i] + (outer[i] - inner[i]) * t) for i in range(3))
    return img


def glow_layer(size, box, color=(255, 196, 92), blur=90, strength=2):
    g = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse(box, fill=color + (255,))
    g = g.filter(ImageFilter.GaussianBlur(blur))
    out = g
    for _ in range(strength - 1):
        out = Image.alpha_composite(out, g)
    return out


def sparkles(img, pts):
    d = ImageDraw.Draw(img)
    for x, y, r in pts:
        d.polygon([(x, y - r), (x + r * .22, y - r * .22), (x + r, y), (x + r * .22, y + r * .22),
                   (x, y + r), (x - r * .22, y + r * .22), (x - r, y), (x - r * .22, y - r * .22)],
                  fill=(255, 244, 214, 235))


def drawn_dumpling():
    """以多層漸層繪製一顆煎得金黃的鍋貼（暫時圖）。"""
    W = S
    mask = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(mask)
    # 半月形餃子：下緣平緩弧線、上緣拱起
    pts = []
    for i in range(181):
        a = math.pi * i / 180
        pts.append((512 - 330 * math.cos(a), 600 - 250 * math.sin(a) ** 0.9))
    for i in range(181):
        a = math.pi * i / 180
        pts.append((512 + 330 * math.cos(a), 600 + 70 * math.sin(a)))
    d.polygon(pts, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(3))
    body = Image.new('RGB', (W, W))
    bp = body.load()
    for y in range(W):
        t = (y - 350) / 320
        t = max(0, min(1, t))
        if t < .55:
            k = t / .55
            col = (int(250 - 20 * k), int(232 - 40 * k), int(196 - 70 * k))
        else:
            k = (t - .55) / .45
            col = (int(230 - 70 * k), int(192 - 100 * k), int(126 - 90 * k))
        for x in range(W):
            bp[x, y] = col
    layer = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    layer.paste(body, (0, 0), mask)
    # 頂部波浪摺邊（在麵皮後方，只露出上緣）
    crest = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    cd = ImageDraw.Draw(crest)
    ridge = []
    for i in range(9):
        a = math.pi * (0.17 + 0.66 * i / 8)
        ridge.append((512 - 330 * math.cos(a), 600 - 250 * math.sin(a) ** 0.9))
    for x, y in ridge:
        cd.ellipse((x - 46, y - 52, x + 46, y + 30), fill=(244, 224, 186, 255), outline=(196, 158, 108, 255), width=5)
        cd.arc((x - 30, y - 40, x + 22, y + 10), 200, 290, fill=(255, 250, 236, 230), width=6)
    layer = Image.alpha_composite(crest, layer)
    # 斜向摺紋（限制在麵皮範圍內）
    folds = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    fd = ImageDraw.Draw(folds)
    for x, y in ridge[1:-1]:
        fd.line([(x + 10, y + 6), (x - 14, y + 60), (x - 40, y + 110)], fill=(206, 168, 116, 200), width=7, joint='curve')
    folds.putalpha(ImageChops.multiply(folds.getchannel('A'), mask))
    layer = Image.alpha_composite(layer, folds)
    # 煎得焦脆的底部
    crisp = Image.new('L', (W, W), 0)
    ImageDraw.Draw(crisp).ellipse((190, 600, 834, 700), fill=200)
    crisp = ImageChops.multiply(crisp.filter(ImageFilter.GaussianBlur(14)), mask)
    layer.paste((140, 70, 22), (0, 0), crisp)
    # 高光
    hl = Image.new('L', (W, W), 0)
    ImageDraw.Draw(hl).ellipse((330, 430, 600, 500), fill=120)
    hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(26)), mask)
    layer.paste((255, 252, 240), (0, 0), hl)
    return layer, (150, 260, 874, 760)


def photo_dumpling(path):
    """把真實照片裁成圓形、提亮並加上柔邊。"""
    im = Image.open(path).convert('RGB')
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((640, 640), Image.LANCZOS)
    im = ImageEnhance.Brightness(im).enhance(1.12)
    im = ImageEnhance.Color(im).enhance(1.15)
    m = Image.new('L', (640, 640), 0)
    ImageDraw.Draw(m).ellipse((10, 10, 630, 630), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(8))
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    layer.paste(im, (192, 192), m)
    return layer, (182, 182, 842, 842)


def compose(dumpling, box, size, pad):
    bg = radial_bg(256).resize((S, S), Image.BICUBIC).convert('RGBA')
    bg = Image.alpha_composite(bg, glow_layer(S, box, blur=110, strength=3))
    x0, y0, x1, y1 = box
    rim = glow_layer(S, (x0 + 40, y0 + 40, x1 - 40, y1 - 40), color=(255, 226, 150), blur=40)
    bg = Image.alpha_composite(bg, rim)
    bg = Image.alpha_composite(bg, dumpling)
    sparkles(bg, [(250, 250, 46), (800, 300, 34), (820, 760, 26), (210, 720, 22), (520, 170, 20)])
    if pad:  # maskable：內容縮到安全區 80%
        inner = bg.resize((int(S * .8), int(S * .8)), Image.LANCZOS)
        full = radial_bg(256).resize((S, S), Image.BICUBIC).convert('RGBA')
        full.alpha_composite(inner, (int(S * .1), int(S * .1)))
        bg = full
    return bg.convert('RGB').resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    layer, box = photo_dumpling(sys.argv[1]) if len(sys.argv) > 1 else drawn_dumpling()
    for name, size, pad in [('icon-512.png', 512, False), ('icon-192.png', 192, False),
                            ('icon-maskable-512.png', 512, True), ('apple-touch-icon.png', 180, False),
                            ('favicon-32.png', 32, False)]:
        compose(layer, box, size, pad).save(os.path.join(OUT, name), optimize=True)
        print('wrote', name)


if __name__ == '__main__':
    main()
