from pxl import *
# Leather pouch / bag: drawstring neck, flap, stitching, brass buckle. (Inventory icon base.)
C = canvas(48, 48)
body = mask_ellipse(23.5, 30, 17, 13) | mask_poly([(10, 26), (37, 26), (33, 18), (14, 18)])
shade(C, body, "leather", style="round")
neck = mask_poly([(16, 12), (31, 12), (33, 19), (14, 19)])
shade(C, neck, "leather", style="cyl", light="w", bias=-0.1)
texture(C, neck, "stripes_v", ["leather.1"], step=3)                  # gathered folds
cord = mask_line(13, 19, 34, 19, width=2)
shade(C, cord, "linen", style="cyl", light="n")
flap = mask_poly([(12, 21), (35, 21), (31, 31), (16, 31)])
shade(C, flap, "leather", style="bevel", bias=0.05)
fill(C, {p for p in edge(flap) if p[1] == 31 or p[0] in (12, 35)}, "leather.0")
stitch = {(x, 23) for x in range(15, 33, 2)}
fill(C, stitch, "linen.3")
buckle = mask_rect(21, 28, 26, 33)
shade(C, buckle, "brass", style="bevel")
fill(C, mask_rect(23, 30, 24, 31), "leather.0")
outline(C)
