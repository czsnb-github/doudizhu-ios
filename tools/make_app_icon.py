"""用现有摩尔庄园素材拼一张 iOS App 图标（不生成新插画）。

素材：static/assets/bg/meadow.jpg + static/assets/avatars/mole_0.jpg
输出：ios/Doudizhu/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ios/Doudizhu/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
SIZE = 1024


def circle_crop(image: Image.Image, size: int) -> Image.Image:
    image = image.convert("RGB")
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def main() -> None:
    meadow = Image.open(ROOT / "static/assets/bg/meadow.jpg").convert("RGB")
    side = min(meadow.size)
    left = (meadow.width - side) // 2
    top = (meadow.height - side) // 2
    background = meadow.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)
    background = background.filter(ImageFilter.GaussianBlur(3))
    background = Image.blend(background, Image.new("RGB", (SIZE, SIZE), (253, 246, 230)), 0.28)

    canvas = background.convert("RGBA")
    draw = ImageDraw.Draw(canvas, "RGBA")

    # 中央奶油圆盘 + 双层描边
    disc = (512, 430)
    radius = 340
    draw.ellipse(
        (disc[0] - radius, disc[1] - radius, disc[0] + radius, disc[1] + radius),
        fill=(255, 250, 240, 235),
        outline=(233, 184, 78, 255),
        width=14,
    )
    draw.ellipse(
        (disc[0] - radius + 18, disc[1] - radius + 18, disc[0] + radius - 18, disc[1] + radius - 18),
        outline=(255, 255, 255, 210),
        width=8,
    )

    avatar = circle_crop(Image.open(ROOT / "static/assets/avatars/mole_0.jpg"), 570)
    canvas.alpha_composite(avatar, (disc[0] - 285, disc[1] - 285))

    # 右下角的小牌
    card_w, card_h = 250, 320
    card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    card_draw = ImageDraw.Draw(card, "RGBA")
    card_draw.rounded_rectangle((8, 8, card_w - 8, card_h - 8), radius=30, fill=(255, 250, 240, 255), outline=(79, 125, 87, 255), width=8)
    font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 168)
    text = "斗"
    bbox = card_draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    card_draw.text(((card_w - tw) / 2 - bbox[0], (card_h - th) / 2 - bbox[1] - 18), text, font=font, fill=(233, 123, 108, 255))

    shadow = Image.new("RGBA", (card_w + 60, card_h + 60), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((30, 38, card_w + 30, card_h + 38), radius=32, fill=(47, 82, 61, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    canvas.alpha_composite(shadow, (700, 640))
    card = card.rotate(-12, expand=True, resample=Image.BICUBIC)
    canvas.alpha_composite(card, (690, 650))

    canvas.convert("RGB").save(OUT, "PNG")
    print("wrote", OUT, OUT.stat().st_size)


if __name__ == "__main__":
    main()
