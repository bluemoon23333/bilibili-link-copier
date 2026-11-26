# -*- coding: utf-8 -*-
"""生成 Edge 加载项商店用的 300x300 扩展徽标。

用法：
    python tools/make-logo.py            # 生成 store/logo-300.png（主设计）
    python tools/make-logo.py --variants # 额外生成 store/logo-variant-*.png 供挑选

设计要点：粉→紫渐变圆角方块（与插件主色一致）+ 白色播放三角 + 右下角 "BV" 胶囊，
在 64px 缩略图和 300px 大图下都能认出来。
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 1200          # 超采样画布
OUT = 300
PINK = (251, 114, 153)
PURPLE = (124, 92, 255)
WHITE = (255, 255, 255)

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "..", "store")


def gradient(size):
    """对角渐变：左上粉 → 右下紫（用 numpy 生成，避免出现硬边）。"""
    import numpy as np

    yy, xx = np.mgrid[0:size, 0:size]
    t = (xx + yy) / (2.0 * (size - 1))
    t = np.clip(t * 1.06 - 0.03, 0, 1)          # 稍微拉开一点对比
    t = t * t * (3 - 2 * t)                     # smoothstep，过渡更柔
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    for k in range(3):
        arr[..., k] = (PINK[k] + (PURPLE[k] - PINK[k]) * t).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def play_triangle(size, cx, cy, h):
    """等腰三角形，顶点朝右，稍微带一点圆角。"""
    w = h * 0.86
    pts = [(cx - w / 2, cy - h / 2), (cx + w / 2, cy), (cx - w / 2, cy + h / 2)]
    layer = Image.new("L", (size, size), 0)
    ImageDraw.Draw(layer).polygon(pts, fill=255)
    return layer.filter(ImageFilter.GaussianBlur(size * 0.004))


def text_pill(base, text, box, radius, font_size, fg, bg):
    """在 base 上画一个圆角胶囊 + 居中文字。"""
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=bg)
    base.alpha_composite(layer)

    font = load_font(font_size)
    d2 = ImageDraw.Draw(base)
    l, t, r, b = d2.textbbox((0, 0), text, font=font)
    x = (box[0] + box[2] - (r - l)) / 2 - l
    y = (box[1] + box[3] - (b - t)) / 2 - t
    d2.text((x, y), text, font=font, fill=fg)


def load_font(size):
    for name in ("arialbd.ttf", "seguisb.ttf", "segoeuib.ttf", "msyhbd.ttc", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def build(variant="main"):
    img = gradient(S).convert("RGBA")
    img.putalpha(rounded_mask(S, int(S * 0.22)))

    if variant == "main":
        # 播放三角 + 右下 BV 胶囊（不重叠）
        tri = play_triangle(S, S * 0.44, S * 0.41, S * 0.42)
        img.alpha_composite(Image.merge("RGBA", (
            Image.new("L", (S, S), 255), Image.new("L", (S, S), 255),
            Image.new("L", (S, S), 255), tri)))
        pill = (int(S * 0.54), int(S * 0.69), int(S * 0.86), int(S * 0.85))
        text_pill(img, "BV", pill, int(S * 0.075), int(S * 0.098), PINK, WHITE)

    elif variant == "plain":
        # 只有三角，和现有图标一致
        tri = play_triangle(S, S * 0.48, S * 0.5, S * 0.54)
        img.alpha_composite(Image.merge("RGBA", (
            Image.new("L", (S, S), 255), Image.new("L", (S, S), 255),
            Image.new("L", (S, S), 255), tri)))

    elif variant == "link":
        # 三角 + 右下角链条环
        tri = play_triangle(S, S * 0.44, S * 0.45, S * 0.42)
        img.alpha_composite(Image.merge("RGBA", (
            Image.new("L", (S, S), 255), Image.new("L", (S, S), 255),
            Image.new("L", (S, S), 255), tri)))
        d = ImageDraw.Draw(img)
        w = int(S * 0.075)
        cx, cy = S * 0.70, S * 0.72
        for dx, dy in ((-S * 0.055, -S * 0.055), (S * 0.055, S * 0.055)):
            d.ellipse([cx + dx - S * 0.105, cy + dy - S * 0.105,
                       cx + dx + S * 0.105, cy + dy + S * 0.105],
                      outline=None, fill=(255, 255, 255, 0))
        d.rounded_rectangle([cx - S * 0.17, cy - S * 0.075, cx + S * 0.02, cy + S * 0.075],
                            radius=w, outline=WHITE, width=w)
        d.rounded_rectangle([cx - S * 0.02, cy - S * 0.075, cx + S * 0.17, cy + S * 0.075],
                            radius=w, outline=WHITE, width=w)

    return img.resize((OUT, OUT), Image.LANCZOS)


def save(img, name):
    os.makedirs(STORE, exist_ok=True)
    path = os.path.join(STORE, name)
    img.save(path, "PNG", optimize=True)
    print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    save(build("main"), "logo-300.png")
    if "--variants" in sys.argv:
        save(build("plain"), "logo-variant-plain.png")
        save(build("link"), "logo-variant-link.png")
