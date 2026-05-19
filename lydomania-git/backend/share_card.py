"""
Lydomania share-card generator.

Composes a 1080x1080 PNG suitable for Telegram story / chat share
when a user wins big (multiplier >= 2). Built with Pillow + Liberation Sans.
"""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Font discovery (Liberation Sans ships with the container's font package)
_FONT_DIR = Path("/usr/share/fonts/truetype/liberation")
FONT_BOLD = _FONT_DIR / "LiberationSans-Bold.ttf"
FONT_REGULAR = _FONT_DIR / "LiberationSans-Regular.ttf"


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(str(path), size=size)


def _radial_gradient(size: tuple[int, int], inner: tuple[int, int, int],
                     outer: tuple[int, int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size, outer)
    px = img.load()
    cx, cy = w / 2, h / 2
    max_r = (cx ** 2 + cy ** 2) ** 0.5
    for y in range(h):
        for x in range(w):
            d = (((x - cx) ** 2 + (y - cy) ** 2) ** 0.5) / max_r
            t = min(1.0, d ** 1.4)
            r = int(inner[0] * (1 - t) + outer[0] * t)
            g = int(inner[1] * (1 - t) + outer[1] * t)
            b = int(inner[2] * (1 - t) + outer[2] * t)
            px[x, y] = (r, g, b)
    return img


# Pre-compute the radial gradient once on import (it's identical for every card)
_BG_RADIAL = None
def _get_bg() -> Image.Image:
    global _BG_RADIAL
    if _BG_RADIAL is None:
        # Smaller resolution then upscale → faster & smoother
        small = _radial_gradient((360, 360), (24, 12, 60), (5, 5, 7))
        _BG_RADIAL = small.resize((1080, 1080), Image.LANCZOS)
    return _BG_RADIAL.copy()


RARITY_RGB = {
    "common":    (148, 163, 184),
    "rare":      (  0, 240, 255),
    "epic":      (138,  43, 226),
    "legendary": (255, 184,   0),
    "mythic":    (255,   0,  60),
    "jackpot":   (255,   0, 229),
}


def _ellipse_glow(size: tuple[int, int], rgb: tuple[int, int, int], strength: int = 80) -> Image.Image:
    w, h = size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for r, a in [(420, strength), (320, strength // 2), (220, strength // 3)]:
        d.ellipse([w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r], fill=rgb + (a,))
    layer = layer.filter(ImageFilter.GaussianBlur(36))
    return layer


def _round_box(draw: ImageDraw.ImageDraw, xy, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def compose_share_card(
    *,
    output_path: Path,
    item_image_path: Path,
    item_name: str,
    rarity: str,
    payout_ton: float,
    multiplier: float,
    case_name: str,
    user_label: str,            # e.g. "@username" or "Lydomania player"
    avatar_image_path: Optional[Path] = None,
    bot_username: str = "lydomania777_bot",
    ref_code: Optional[str] = None,
) -> Path:
    """
    Build the 1080x1080 PNG. Returns output_path on success.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    accent = RARITY_RGB.get(rarity, RARITY_RGB["common"])

    bg = _get_bg()
    glow = _ellipse_glow((1080, 1080), accent, strength=110)
    bg.paste(glow, (0, 0), glow)

    canvas = bg.convert("RGBA")

    # --- Header: avatar + username ---
    header_top = 70
    if avatar_image_path and avatar_image_path.exists():
        try:
            av = Image.open(avatar_image_path).convert("RGBA").resize((104, 104))
            mask = Image.new("L", (104, 104), 0)
            ImageDraw.Draw(mask).ellipse([0, 0, 104, 104], fill=255)
            canvas.paste(av, (70, header_top), mask)
        except Exception:
            pass
    else:
        d = ImageDraw.Draw(canvas)
        d.ellipse([70, header_top, 70 + 104, header_top + 104],
                  fill=(15, 15, 19), outline=accent + (255,), width=3)
        initial = (user_label or "?").lstrip("@")[:1].upper() or "L"
        f_init = _font(56)
        bbox = d.textbbox((0, 0), initial, font=f_init)
        d.text(
            (70 + 52 - (bbox[2] - bbox[0]) / 2,
             header_top + 52 - (bbox[3] - bbox[1]) / 2 - 6),
            initial, fill=(255, 255, 255, 255), font=f_init,
        )

    # username + brand
    d = ImageDraw.Draw(canvas)
    d.text((200, header_top + 14), user_label, fill=(255, 255, 255, 255),
           font=_font(40, bold=True))
    d.text((200, header_top + 64), f"won at LYDOMANIA · {case_name}",
           fill=(255, 255, 255, 180), font=_font(26, bold=False))

    # --- Big item image centered ---
    img_box_y = 230
    img_box_size = 540
    img_box_x = (1080 - img_box_size) // 2

    # Glow under item
    item_glow = _ellipse_glow((img_box_size + 200, img_box_size + 200), accent, strength=180)
    canvas.paste(item_glow,
                 (img_box_x - 100, img_box_y - 100), item_glow)

    if item_image_path.exists():
        try:
            it = Image.open(item_image_path).convert("RGBA")
            it.thumbnail((img_box_size, img_box_size), Image.LANCZOS)
            ix = img_box_x + (img_box_size - it.width) // 2
            iy = img_box_y + (img_box_size - it.height) // 2
            canvas.paste(it, (ix, iy), it)
        except Exception:
            pass

    # --- Rarity pill ---
    d = ImageDraw.Draw(canvas)
    label = rarity.upper()
    f_pill = _font(26)
    pill_bbox = d.textbbox((0, 0), label, font=f_pill)
    pw, ph = pill_bbox[2] - pill_bbox[0] + 60, pill_bbox[3] - pill_bbox[1] + 24
    pill_x = (1080 - pw) // 2
    pill_y = img_box_y + img_box_size + 18
    _round_box(d, [pill_x, pill_y, pill_x + pw, pill_y + ph], 24,
               fill=accent + (50,), outline=accent + (220,), width=3)
    d.text((pill_x + 30, pill_y + 10 - 4), label,
           fill=accent + (255,), font=f_pill)

    # --- Item name ---
    f_name = _font(80, bold=True)
    nb = d.textbbox((0, 0), item_name, font=f_name)
    d.text(((1080 - (nb[2] - nb[0])) // 2, pill_y + ph + 22), item_name,
           fill=(255, 255, 255, 255), font=f_name)

    # --- Payout + multiplier row ---
    payout_label = f"{payout_ton:.2f}".rstrip("0").rstrip(".") + " TON"
    mult_label = f"×{multiplier:.2f}".rstrip("0").rstrip(".")
    f_pay = _font(74)
    f_mul = _font(54)
    pb = d.textbbox((0, 0), payout_label, font=f_pay)
    mb = d.textbbox((0, 0), mult_label, font=f_mul)
    pw = pb[2] - pb[0]
    mw = mb[2] - mb[0]
    gap = 40
    total = pw + gap + mw
    base_x = (1080 - total) // 2
    base_y = pill_y + ph + 130
    d.text((base_x, base_y), payout_label,
           fill=(255, 255, 255, 255), font=f_pay)
    d.text((base_x + pw + gap, base_y + 12), mult_label,
           fill=accent + (255,), font=f_mul)

    # --- Footer: bot deep link ---
    footer_y = 1080 - 90
    link = f"t.me/{bot_username}"
    if ref_code:
        link += f"?start=ref_{ref_code}"
    f_link = _font(30, bold=True)
    lb = d.textbbox((0, 0), link, font=f_link)
    d.text(((1080 - (lb[2] - lb[0])) // 2, footer_y), link,
           fill=accent + (255,), font=f_link)
    d.text(((1080 - 200) // 2, footer_y - 36),
           "OPEN. WIN. WITHDRAW.",
           fill=(255, 255, 255, 140), font=_font(20))

    canvas.convert("RGB").save(output_path, "PNG", optimize=True)
    return output_path
