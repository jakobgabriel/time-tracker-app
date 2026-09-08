from PIL import Image, ImageDraw
import math

GLYPH = (12, 13, 14, 255)  # graphite, the same ink the app puts on lime

S = 1024
SS = 4  # supersample
img = Image.new("RGBA", (S*SS, S*SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-square backdrop with a subtle lime ramp.
top = (207, 250, 84)
bot = (168, 224, 31)
grad = Image.new("RGB", (1, S*SS))
for y in range(S*SS):
    t = y / (S*SS - 1)
    grad.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
grad = grad.resize((S*SS, S*SS))

mask = Image.new("L", (S*SS, S*SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S*SS-1, S*SS-1], radius=int(S*SS*0.22), fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
cx = cy = S*SS//2
r = int(S*SS*0.29)
w = int(S*SS*0.055)

# Open dial: a ring with a gap at the top, like a stopwatch mid-run.
d.arc([cx-r, cy-r, cx+r, cy+r], start=-62, end=242, fill=GLYPH, width=w)

# Hand pointing at ~2 o'clock, plus the crown above it.
ang = math.radians(-52)
hr = int(r*0.66)
d.line([cx, cy, cx + hr*math.cos(ang), cy + hr*math.sin(ang)],
       fill=GLYPH, width=w, joint="curve")
d.ellipse([cx-w//2, cy-w//2, cx+w//2, cy+w//2], fill=GLYPH)
cw = int(S*SS*0.045)
d.rounded_rectangle([cx-cw, cy-r-int(w*1.9), cx+cw, cy-r+int(w*0.4)],
                    radius=cw//2, fill=GLYPH)

img = img.resize((S, S), Image.LANCZOS)
img.save("src-tauri/icons/app-icon.png")
print("written")
