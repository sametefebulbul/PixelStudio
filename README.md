# Pixel Studio

A local studio for **LLM-drawn pixel art**. Describe a sprite, let Claude turn it into a precise drawing prompt, approve it, then **watch the model draw** step by step, **compare variations**, and **pin feedback to any region** of the result — like comments on a document — for a targeted fix round.

No image generator and no paid art service are needed: the model draws by writing a short Python script against the bundled **pxl** engine (masks → automatic shading → outline → details), and checks itself with a pixel linter (and, if it can see images, with zoomed previews).

> Türkçe açıklama aşağıda.

## Features
- **Prompt refinement** — free text in any language → structured spec (parts, materials/ramps, coordinates, details, avoid list) you can edit before drawing.
- **Stable-Diffusion-style settings** — size, palette (bundled or your own), route, model, effort, variations, seed, light direction, outline (full/selective/none), shading style, band-edge dither, tones per material, detail level, fix rounds, negative prompt.
- **Methods** — *hybrid* (procedural block-in, then the model hand-paints the pixel grid; default), *direct grid* (the model writes the rows itself), *procedural* (script only). Optional **art-director rounds**: a vision critic names the 3 worst problems with pixel regions and the artist fixes only those; optional **auto-pick** stars the best variation.
- **Your rating** — rate any variation 1–5 with a note; ratings are logged to `~/.pixel-studio/ratings.jsonl` with method/model/settings so you can see what you actually prefer.
- **Routes** — *draw* from scratch, *variant* (recolor an existing sprite while keeping its hand-made shading — instant, no LLM), *kitbash* parts of existing sprites, *convert* a reference image.
- **Live drawing** — every render the agent makes appears in a scrubbable step timeline with its lint score, next to the agent's log (thoughts, tool calls, results).
- **Variations** — run up to 6 candidates in parallel; compare side by side or with a swipe; star; "continue from this".
- **Region comments** — drag a box on the canvas, write a note, collect several, apply them in one fix round. The agent edits only those regions; the app measures and reports any pixels changed outside them.
- **Providers** — Claude Code CLI (your subscription), opencode (GLM, DeepSeek, …), Anthropic API key, any OpenAI-compatible API. Blind (text-only) models get ASCII views + lint instead of images.
- **Export** — PNG at 1×–8×, the drawing script (`.py`), a palette grid (`.json`), optional copy into your game folder.

## Requirements
- Node.js ≥ 20
- Python 3 with Pillow (`pip install pillow`)
- At least one provider: [Claude Code](https://claude.com/claude-code) signed in, [opencode](https://opencode.ai), or an API key

## Run
```bash
npm install
npm run build
npm start            # → http://127.0.0.1:5178
# or: node bin/pixel-studio.js   (builds on first run, opens the browser)
```
Development: `npm run dev` (server on :5178, Vite UI on :5173 with proxy).

Projects are stored in `~/.pixel-studio/projects` (override with `PIXEL_STUDIO_HOME`). Add your own sprite folders as start sprites with `PIXEL_STUDIO_LIBRARY=/path/a:/path/b`. The server only listens on 127.0.0.1.

## The engine as a skill
`engine/` is also an agent skill (`SKILL.md` + `scripts/pxl.py` + palettes, recipes, examples). Link it into Claude Code (`~/.claude/skills/pixel-art`) or opencode (`~/.config/opencode/skills/pixel-art`) to draw from the terminal:
```bash
python3 engine/scripts/pxl.py render engine/references/recipes/potion.py -o potion.png --preview
python3 engine/scripts/pxl.py lint potion.png
python3 engine/scripts/pxl.py variant some_item.png --hue 0:215:30 -o blue.png
```

## Benchmark
`bench/` draws 12 fixed subjects with each strategy and (optionally) has a vision model judge them blind next to hand-made CC0 references: `python3 bench/run.py S2 --model sonnet`, `python3 bench/judge.py S1_sonnet S2_sonnet reference`. **Note:** every run is a real model session on your own quota (a full S1–S4 run is ~60 sessions); start with `--only sword,key`. AI judges disagree with human taste (they rated hand-made references lowest) — treat scores as a rough guide, your own ratings as the truth.

## Private library
Put your own palettes/examples in `~/.pixel-studio/library/{palettes,examples}` (or `$PXL_LIBRARY`); they are picked up but never part of the repo.

## Tests
```bash
npm test     # server unit tests + engine self-test
```

## License
MIT

---

## Türkçe

Pixel Studio, yapay zekâ modellerinin piksel sanat çizmesi için yerel bir stüdyo. İsteğini yaz → Claude bunu ölçülebilir bir çizim istemine çevirsin → önizle, düzenle, onayla → modelin adım adım çizişini izle → varyasyonları karşılaştır → sonucun herhangi bir bölgesine yorum iğnele ve yalnız o bölgeyi düzelttir.

Görüntü üreteci ya da ücretli sanat servisi gerekmez: model, `pxl` motoruna kısa bir Python betiği yazarak çizer (maske → otomatik gölge → kontur → ayrıntı), piksel denetleyiciyle (görüntü okuyabiliyorsa büyütülmüş önizlemeyle de) kendini kontrol eder.

Çalıştırma: `npm install && npm run build && npm start` → http://127.0.0.1:5178
