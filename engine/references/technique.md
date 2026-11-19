# Pixel-art technique for small sprites (16–48 px)

Hand-made sprites look good because every pixel was *decided*. These rules are what the decisions are made of. They are written from the CC0 references in `examples/` and common practice.

## 1. Silhouette first
- The object must be recognisable as a flat black shape. Exaggerate the identifying parts (blade length, cap of a mushroom, handle of a mug); simplify everything else.
- Give it a pose: long objects diagonal (45°), round objects slightly ¾ with a flatter bottom.
- Fill the canvas: ~85–95 % of the long axis, 1 px free border for the outline.
- 1 px nubs, 1 px holes and lumpy curves read as noise. Curves are made of runs that change length smoothly: 4-3-2-1-1, never 3-1-3.

## 1b. It must work in the real world (plausibility and proportion)
Stylised is fine; impossible is not. Before drawing, write the real object's proportions and its *function*, then check the sprite against them:
- **Wearables fit a head/body.** A helmet's dome is only a little taller than the skull (dome ≈ 35–45 % of total helmet height); the face opening or eye slits sit at eye height and are wide enough to see through (open-face: the opening is ~⅓–½ of the helmet width; a great helm has two clear eye slits ~¼ down from the top of the face plate, plus breathing holes). Cheek guards end around the jaw.
- **Tools and weapons are holdable.** Grips are about a hand wide (4–6 % of a sword's length ×2), a sword's guard is wider than the grip, a blade is longer than the grip (blade ≈ 70–75 % of a sword), an axe head sits at the end of the haft, a mug's handle leaves a gap for fingers.
- **Containers hold things.** A potion has a neck narrower than its body and a stopper that fits the neck; a pouch has a gathered neck and a tie; a chest lid matches the box.
- **Parts connect.** Nothing floats: a cork sits *in* the neck, a gem sits *in* a setting with prongs, a blade meets the guard, straps wrap around something.
- **Scale between parts is consistent.** Rivets, nails, stitches are all similar small sizes; a gem is not bigger than the ring band can hold.
Ask: "Could a person use/wear/hold this? Where are the eyes, hands, fingers?" If not, fix the proportions before any shading.

## 1c. Design like an illustrator, not an icon font
Measured from the hand-made references — the usual gap between an amateur and a pro sprite:
- **Elegant proportions.** Long items span the full diagonal (from ~(2,29) to ~(29,2) on 32 px) and are *slender*: a sword blade 2–3 px wide, a haft/handle 1–2 px, a bow limb 1–2 px. Chunky 5–6 px blades and stubby hafts look like toys.
- **¾ perspective with depth.** Containers and vessels show their opening (a mug's dark interior ellipse, a sack's gathered mouth, a pot's rim) and their top surface; scrolls show the curl of the paper; ingots show top and side faces. Pure front views look flat.
- **Character and detail density.** Each item has 2–4 crafted details at pixel scale: a curved/quillon crossguard, a ricasso line, a wrapped grip with alternating pixels, a pommel with a glint, an ornate key bow with loops, flanges/spikes with individual highlights, knots in wood, frayed paper edges, stitching. Simplified generic shapes read as clip-art.
- **Bold value structure.** Strong dark core shadows next to bright highlights; outlines dark and continuous; metal shows near-white specular pixels next to dark reflections.
- **Asymmetry and life.** Slight tilt, uneven folds, a ribbon tail, a worn edge — perfectly symmetric, axis-aligned shapes look generated.

## 2. Value before color
- Decide 3–4 values per material: shadow, base, light, highlight. Most of the area is base + shadow; light is a band; highlight is 1–4 pixels.
- Light from the top-left: lit edges top/left, shadow bottom/right, plus occlusion where parts touch (under a cap, where a blade meets a guard).
- Contrast is the readability budget. Metals and gems: strong (dark core next to near-white glint). Wood, cloth, leather, paper: soft (neighbouring tones only).

## 3. Color
- Ramps are hue-shifted: shadows cooler (toward blue/purple), lights warmer (toward yellow). Never just darker/lighter grey of the same hue.
- Few colors: a 32 px item uses 8–16 colors total. Reuse the same dark for outline and deepest shadow across materials when possible.

## 4. Outline
- 1 px, very dark (not pure black on dark UIs) around the silhouette.
- Inside the object, separate parts with the darkest tone of the part *behind*, not with black.
- Selective outline (optional, ≥32 px): on the lit side the outline may become the material's dark tone instead of black.

## 5. Highlights and glints
- A highlight is a *decision*: a short line along a lit edge (blade spine, rim of a mug, top of an ingot) or 1–3 pixels on a round surface toward the light. Never sprinkle.
- Metal: a 1 px near-white line along the lit edge + 1 px dark line on the shadow edge = instant "steel".
- Glass/liquid: a curved light streak near the lit side, a shorter parallel one, the liquid's surface line one tone lighter.
- Gems: dark facet next to a bright facet; one white pixel.

## 6. Texture by suggestion
- Suggest, don't render: wood = 2–4 short darker streaks along the grain; leather = a few darker pixels + stitches; cloth = 1–2 fold lines; stone = 2–3 cracks + 1–2 lighter grit pixels; fur = small clusters of 2–3 px strands on the edge.
- Texture pixels are one tone darker/lighter than their neighbours, never outline-black, and never more contrast than the main light/shadow split.

## 7. Clean-up (what separates pro from amateur)
- No orphan pixels with no reason, no 1-px "pillow" ring of shadow around the whole shape, no doubled outline.
- Jaggies: diagonal lines in clean 1:1, 2:1 or 1:2 steps. Use a mid-tone pixel in the inner corner of a step only where it smooths a curve (manual anti-aliasing), and only inside the shape.
- Check at 1× size: if a detail does not read at 1×, remove it or make it bigger.

## 8. Working order
1. Silhouette (flat dark) → 2. flat base colors per part → 3. shadow shapes → 4. light + highlights → 5. outline and inner separation lines → 6. texture hints → 7. clean-up at 1×.
Compare with a reference of the same kind at the same scale after steps 3 and 7.
