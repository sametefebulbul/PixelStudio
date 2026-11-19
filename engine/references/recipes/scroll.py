from pxl import *
# Rolled scroll with wax seal, diagonal.
C = canvas(48, 48)
paper = mask_poly([(8, 30), (30, 8), (40, 18), (18, 40)])
shade(C, paper, "linen", style="cyl", levels=[2, 3, 4])
for k in range(3):
    fill(C, mask_line(14 + 4 * k, 30 - 0, 28 + 4 * k, 16) & paper, "linen.2")  # text lines
roll_a = mask_line(7, 29, 29, 7, width=5)
roll_b = mask_line(19, 41, 41, 19, width=5)
shade(C, roll_a, "linen", style="cyl")
shade(C, roll_b, "linen", style="cyl")
seal = mask_circle(26, 30, 3)
shade(C, seal, "red", style="round")
fill(C, mask_line(27, 33, 29, 37, width=2), "red.2")
outline(C)
