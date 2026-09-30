"""
Script to generate ultra-high-definition LaserLockAI branding icons (.ico, .png)
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

def create_laserlock_icon():
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Base dark badge with rounded rectangle
    margin = 32
    radius = 220
    
    # Draw subtle background glow
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.rounded_rectangle(
        [margin - 10, margin - 10, size - margin + 10, size - margin + 10],
        radius=radius + 10,
        fill=(123, 47, 255, 60)
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=20))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)

    # Deep space gradient-like base badge
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=(6, 8, 24, 255),
        outline=(0, 212, 255, 180),
        width=8
    )

    # Secondary inner bezel
    draw.rounded_rectangle(
        [margin + 16, margin + 16, size - margin - 16, size - margin - 16],
        radius=radius - 12,
        outline=(123, 47, 255, 100),
        width=4
    )

    cx, cy = size // 2, size // 2

    # Targeting Grid lines (faint cyan)
    grid_spacing = 72
    for x in range(cx - 360, cx + 361, grid_spacing):
        draw.line([(x, cy - 360), (x, cy + 360)], fill=(0, 180, 255, 30), width=2)
    for y in range(cy - 360, cy + 360, grid_spacing):
        draw.line([(cx - 360, y), (cx + 360, y)], fill=(0, 180, 255, 30), width=2)

    # Concentric Reticle Rings
    # Outer ring
    draw.ellipse([cx - 340, cy - 340, cx + 340, cy + 340], outline=(123, 47, 255, 160), width=6)
    # Middle dashed ring
    for deg in range(0, 360, 15):
        rad = math.radians(deg)
        r1, r2 = 240, 256
        x1 = cx + int(r1 * math.cos(rad))
        y1 = cy + int(r1 * math.sin(rad))
        x2 = cx + int(r2 * math.cos(rad))
        y2 = cy + int(r2 * math.sin(rad))
        draw.line([(x1, y1), (x2, y2)], fill=(0, 212, 255, 200), width=4)

    # Inner precise ring
    draw.ellipse([cx - 150, cy - 150, cx + 150, cy + 150], outline=(0, 212, 255, 230), width=6)

    # Crosshairs with center gap
    gap = 80
    span = 380
    # Top
    draw.line([(cx, cy - span), (cx, cy - gap)], fill=(0, 220, 255, 255), width=8)
    # Bottom
    draw.line([(cx, cy + gap), (cx, cy + span)], fill=(0, 220, 255, 255), width=8)
    # Left
    draw.line([(cx - span, cy), (cx - gap, cy)], fill=(0, 220, 255, 255), width=8)
    # Right
    draw.line([(cx + gap, cy), (cx + span, cy)], fill=(0, 220, 255, 255), width=8)

    # Target brackets [ ]
    b_len = 50
    b_dist = 110
    # Top Left
    draw.line([(cx - b_dist, cy - b_dist), (cx - b_dist + b_len, cy - b_dist)], fill=(255, 50, 100, 255), width=6)
    draw.line([(cx - b_dist, cy - b_dist), (cx - b_dist, cy - b_dist + b_len)], fill=(255, 50, 100, 255), width=6)
    # Top Right
    draw.line([(cx + b_dist, cy - b_dist), (cx + b_dist - b_len, cy - b_dist)], fill=(255, 50, 100, 255), width=6)
    draw.line([(cx + b_dist, cy - b_dist), (cx + b_dist, cy - b_dist + b_len)], fill=(255, 50, 100, 255), width=6)
    # Bottom Left
    draw.line([(cx - b_dist, cy + b_dist), (cx - b_dist + b_len, cy + b_dist)], fill=(255, 50, 100, 255), width=6)
    draw.line([(cx - b_dist, cy + b_dist), (cx - b_dist, cy + b_dist - b_len)], fill=(255, 50, 100, 255), width=6)
    # Bottom Right
    draw.line([(cx + b_dist, cy + b_dist), (cx + b_dist - b_len, cy + b_dist)], fill=(255, 50, 100, 255), width=6)
    draw.line([(cx + b_dist, cy + b_dist), (cx + b_dist, cy + b_dist - b_len)], fill=(255, 50, 100, 255), width=6)

    # Incoming Laser Beam (Diagonal cyan-purple energy line hitting the lock)
    laser_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    laser_draw = ImageDraw.Draw(laser_layer)
    laser_draw.line([(cx - 420, cy + 320), (cx, cy)], fill=(0, 212, 255, 200), width=18)
    laser_draw.line([(cx - 420, cy + 320), (cx, cy)], fill=(255, 255, 255, 240), width=6)
    laser_layer = laser_layer.filter(ImageFilter.GaussianBlur(radius=6))
    img = Image.alpha_composite(img, laser_layer)
    draw = ImageDraw.Draw(img)

    # Core Beacon Laser Spot with high-intensity bloom
    beacon_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(beacon_layer)
    # Red/magenta outer halo
    b_draw.ellipse([cx - 70, cy - 70, cx + 70, cy + 70], fill=(255, 20, 80, 120))
    b_draw.ellipse([cx - 45, cy - 45, cx + 45, cy + 45], fill=(255, 60, 110, 220))
    # Bright white core
    b_draw.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], fill=(255, 255, 255, 255))
    beacon_glow = beacon_layer.filter(ImageFilter.GaussianBlur(radius=10))
    img = Image.alpha_composite(img, beacon_glow)
    img = Image.alpha_composite(img, beacon_layer)

    # Save PNG
    output_dir = os.path.dirname(os.path.abspath(__file__))
    png_path = os.path.join(output_dir, "icon.png")
    img.save(png_path, format="PNG")
    print(f"[*] Saved {png_path}")

    # Generate multi-size Windows icon (.ico)
    ico_path = os.path.join(output_dir, "icon.ico")
    img_256 = img.resize((256, 256), Image.Resampling.LANCZOS)
    img_256.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print(f"[*] Saved {ico_path}")

    # Generate Tray icon (.ico)
    tray_path = os.path.join(output_dir, "tray.ico")
    tray_img = img.resize((32, 32), Image.Resampling.LANCZOS)
    tray_img.save(tray_path, format="ICO", sizes=[(16, 16), (32, 32)])
    print(f"[*] Saved {tray_path}")

if __name__ == "__main__":
    create_laserlock_icon()
