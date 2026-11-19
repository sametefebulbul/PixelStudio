from pxl import *
# Round wooden shield: vertical planks, iron rim, central boss, nails.
C = canvas(48, 48)
disc = mask_circle(23.5, 23.5, 21)
wood = shrink(disc, 3)
rim = disc - wood
shade(C, rim, "iron", style="round", levels=[1, 2, 3, 4])
shade(C, wood, "wood", style="round", levels=[1, 2, 3])
for x in range(9, 40, 6):                       # plank seams
    fill(C, {(xx, y) for (xx, y) in wood if xx == x}, "wood.0")
texture(C, wood, "grain", ["wood.1"], step=2, seed=3)
boss = mask_circle(23.5, 23.5, 5)
shade(C, boss, "steel", style="round")
fill(C, (grow(boss, 1) - boss) & wood, "wood.0")       # dark ring separates boss from planks
for (x, y) in [(23, 5), (23, 42), (5, 23), (42, 23), (11, 11), (36, 11), (11, 36), (36, 36)]:
    px(C, x, y, "steel.4")
outline(C)
