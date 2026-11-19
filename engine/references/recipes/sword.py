from pxl import *
# Diagonal short sword, PixelLab proportions: long slim bright blade filling the diagonal, thin crossguard,
# short wrapped grip, round pommel. Metal = mostly light tones, dark line on the shadow edge, white lit edge.
C = canvas(48, 48)
blade = smooth_mask(mask_poly([(14, 29), (38, 5), (44, 3), (42, 9), (18, 33)]))   # ~6px wide, tip top-right
shade(C, blade, "steel", style="cyl", levels=[2, 3, 4], highlight=False)
edge_shadow = {p for p in edge(blade) if (p[0] + 1, p[1] + 1) not in blade}      # shadow-side edge (bottom-right)
fill(C, edge_shadow, "steel.1")
glint(C, blade, "white", pos=0.9, length=0.8)                                     # lit edge
fill(C, mask_line(19, 28, 38, 9) & blade, "steel.3")                              # fuller
guard = mask_line(9, 25, 21, 37, width=3)                                         # thin crossguard across the blade
shade(C, guard, "brass", style="cyl", levels=[1, 2, 3, 4])
grip = mask_line(8, 38, 14, 32, width=2)
shade(C, grip, "leather", style="cyl", levels=[1, 2, 3])
texture(C, grip, "diag", ["leather.0"], step=2)
pommel = mask_circle(6, 40, 2)
shade(C, pommel, "brass", style="form")
outline(C, selective=True)
center(C)
