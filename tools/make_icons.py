"""生成扩展图标（纯标准库实现，不需要 Pillow）。

图形为 B 站粉圆角方块加白色播放三角，输出到 icons/icon{16,32,48,128}.png。
"""

from __future__ import annotations

import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"
SIZES = (16, 32, 48, 128)

PINK = (251, 114, 153)
WHITE = (255, 255, 255)
SUPERSAMPLE = 4


def in_rounded_rect(x: float, y: float, size: float, radius: float) -> bool:
    """点 (x, y) 是否落在圆角方块内（像素坐标，原点在左上）。"""
    if x < 0 or y < 0 or x > size or y > size:
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius + 1e-9


def in_triangle(x: float, y: float, points) -> bool:
    (x1, y1), (x2, y2), (x3, y3) = points

    def side(ax, ay, bx, by, px, py):
        return (ax - px) * (by - py) - (bx - px) * (ay - py)

    d1 = side(x1, y1, x2, y2, x, y)
    d2 = side(x2, y2, x3, y3, x, y)
    d3 = side(x3, y3, x1, y1, x, y)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def render_raw(size: int) -> bytes:
    radius = size * 0.22
    triangle = (
        (size * 0.375, size * 0.295),
        (size * 0.375, size * 0.705),
        (size * 0.715, size * 0.500),
    )

    step = 1.0 / SUPERSAMPLE
    samples = SUPERSAMPLE * SUPERSAMPLE
    raw = bytearray()

    for py in range(size):
        raw.append(0)  # PNG 每行前缀：滤波器类型 0
        for px in range(size):
            r_acc = g_acc = b_acc = a_acc = 0.0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = px + (sx + 0.5) * step
                    y = py + (sy + 0.5) * step
                    if not in_rounded_rect(x, y, size, radius):
                        continue
                    if in_triangle(x, y, triangle):
                        r_acc += WHITE[0]
                        g_acc += WHITE[1]
                        b_acc += WHITE[2]
                    else:
                        r_acc += PINK[0]
                        g_acc += PINK[1]
                        b_acc += PINK[2]
                    a_acc += 255
            if a_acc == 0:
                raw.extend((0, 0, 0, 0))
                continue
            covered = a_acc / 255
            raw.extend(
                (
                    int(round(r_acc / covered)),
                    int(round(g_acc / covered)),
                    int(round(b_acc / covered)),
                    int(round(a_acc / samples)),
                )
            )
    return bytes(raw)


def encode_png(size: int, raw: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8bit RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        target = ICON_DIR / f"icon{size}.png"
        target.write_bytes(encode_png(size, render_raw(size)))
        print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
