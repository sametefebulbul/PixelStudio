from pxl import *
# Open-face nasal helmet, front view, REAL proportions (see technique.md 1b):
# total height ~40px: dome ~16px (40 %) only slightly taller than a skull; brow band at eye level;
# face opening ~20px wide (half the helmet) from the brow down — wide enough to see through;
# thin nasal bar (2px); cheek guards that end at jaw height; dark interior shows the inside rim.
C = canvas(48, 48)
W0, W1 = 6, 41                      # helmet width ~36px
dome = mask_ellipse(23.5, 22, 17.5, 16) - mask_rect(0, 23, 47, 47)   # top cap: rows 6..22 (~16px)
band = mask_rect(W0, 20, W1, 24)                                      # brow band at eye level
sides = mask_poly([(W0, 24), (14, 24), (14, 44), (9, 42), (W0, 36)]) | mask_poly([(33, 24), (W1, 24), (W1, 36), (38, 42), (33, 44)])
shell = smooth_mask(dome | band | sides)
shade(C, shell, "steel", style="form", levels=[1, 2, 3, 4])
shade(C, band, "brass", style="cyl", light="n", levels=[1, 2, 3, 4], highlight=False)
fill(C, {(x, 19) for x in range(W0 + 2, W1 - 1)} & shell, "steel.1")                 # shadow line above the band
for x in range(9, 40, 5):
    px(C, x, 22, "brass.4")                                                          # rivets on the band
ridge = mask_rect(23, 7, 24, 19) & shell
fill(C, ridge, "steel.4"); fill(C, {(25, y) for y in range(8, 20)} & shell, "steel.1")  # raised center ridge
face = mask_rect(15, 25, 32, 47) & grow(shell, 3)                                    # opening: 18px wide, eye level down
face = {p for p in face if p[1] <= 43}
erase(C, face)
inner = {(x, y) for (x, y) in face if y <= 28 or x in (15, 32)}                      # visible inside rim / padding
fill(C, inner, "leather.1")
nasal = mask_rect(23, 25, 24, 34)
shade(C, nasal, "steel", style="cyl", light="w", levels=[2, 3, 4], highlight=False)
fill(C, {(23, 34), (24, 34)}, "steel.1")
outline(C)
center(C)
