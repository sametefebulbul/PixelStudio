from pxl import *
# Round potion flask. Techniques: form (volume) lighting, liquid with its own ramp + surface line,
# glass rim, two parallel glints, cork with grain, rim light + selective outline.
C = canvas(48, 48)
body = mask_circle(24, 31, 12)
neck = mask_rect(20, 11, 27, 20)
lip = mask_rect(18, 9, 29, 11)
glass = body | neck | lip
shade(C, glass, "glass", style="form", levels=[1, 2, 3], highlight=False)
liquid = {p for p in shrink(body, 2) if p[1] >= 26}
shade(C, liquid, "red", style="form", levels=[1, 2, 3, 4], dither=True)
fill(C, {p for p in liquid if p[1] == 26}, "red.4")                 # surface line
fill(C, {p for p in liquid if p[1] == 27}, "red.3")
fill(C, edge(glass) - lip, "glass.1")                                # darker glass rim
cork = mask_rect(20, 4, 27, 9)
shade(C, cork, "wood", style="cyl", light="w", levels=[1, 2, 3, 4])
texture(C, cork, "stripes_h", ["wood.1"], step=3)
fill(C, mask_curve([(16, 25), (14, 31), (16, 37)]), "glass.4")      # long curved glint
fill(C, mask_curve([(19, 23), (18, 26), (18, 28)]), "white")         # short parallel glint
px(C, 22, 13, "white"); px(C, 22, 14, "glass.4")
rim_light(C)
outline(C, selective=True)
