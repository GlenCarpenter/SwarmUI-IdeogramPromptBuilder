# SwarmUI — Ideogram Prompt Builder

A SwarmUI extension that provides a dedicated visual editor for constructing **Ideogram 4 structured JSON captions** — the prompt format used by Ideogram 4 models that describes an image as a hierarchy of typed elements with optional bounding boxes, color palettes, and style descriptors.

## Features

- **Visual bounding-box canvas** — draw, move, and resize element regions directly on a proportional canvas that matches your chosen output dimensions
- **Structured caption editor** — fill in high-level description, style (photo or art style), background, and per-element fields that map 1-to-1 to the Ideogram 4 JSON schema
- **Color palettes** — assign up to 16 global style colors and up to 5 per-element colors via swatch pickers
- **Live JSON preview** — the caption JSON updates in real time as you edit; copy or import via clipboard
- **Model selector** — picks from your loaded diffusion models and sets SwarmUI's active model before generating
- **In-canvas image preview** — after generation completes the result is drawn directly onto the canvas as a background so you can immediately compare placement against your bounding boxes
- **Resizable sidebar** — drag the border to trade sidebar width for canvas space

## Usage

1. Open the **Ideogram Prompt Builder** tab in SwarmUI's Generate page
2. Select an **Aspect Ratio** (or enter custom dimensions) — the canvas resizes to match
3. Choose a **Model** from the dropdown
4. Fill in the **High Level Description**, **Style Description**, and **Background** fields
5. Draw bounding boxes on the canvas by clicking and dragging; right-click a box to delete it
6. Select a box to edit its **Type** (obj / text), **Description**, and optional color palette in the sidebar
7. Review the **JSON Preview** at the bottom of the sidebar
8. Click **▶ Generate** — the job is queued through SwarmUI's normal generation pipeline; when complete the result loads into the canvas background
9. Use **Clear Preview** (canvas toolbar) to remove the background image

## JSON Schema

The editor builds captions conforming to the Ideogram 4 structured prompt format:

```json
{
  "high_level_description": "…",
  "style_description": {
    "aesthetics": "…",
    "lighting": "…",
    "photo": "…",
    "medium": "…",
    "color_palette": ["#RRGGBB", "…"]
  },
  "compositional_deconstruction": {
    "background": "…",
    "elements": [
      {
        "type": "obj",
        "bbox": [y_min, x_min, y_max, x_max],
        "desc": "…",
        "color_palette": ["#RRGGBB"]
      },
      {
        "type": "text",
        "bbox": [y_min, x_min, y_max, x_max],
        "text": "Hello",
        "desc": "…"
      }
    ]
  }
}
```

`bbox` values are integers on a **0–1000** grid (`[y_min, x_min, y_max, x_max]`). Elements without a drawn bounding box are included without a `bbox` field.

## Model Downloads

You need an Ideogram 4 diffusion model in your SwarmUI `Models/diffusion_models/` folder.

| Model | Size | Link |
|---|---|---|
| Ideogram 4 FP8 (recommended) | ~9 GB | [Comfy-Org/Ideogram-4 — ideogram4_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_fp8_scaled.safetensors) |
| Ideogram 4 NVFP4 (smaller, Blackwell GPUs) | ~5 GB | [Comfy-Org/Ideogram-4 — ideogram4_nvfp4_mixed.safetensors](https://huggingface.co/Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_nvfp4_mixed.safetensors) |
| Ideogram 4 Unconditional FP8 (optional) | ~9 GB | [Comfy-Org/Ideogram-4 — diffusion_models tree](https://huggingface.co/Comfy-Org/Ideogram-4/tree/main/diffusion_models) |

> **Tip:** The unconditional model is used for the negative half of CFG. It is optional and not currently required by SwarmUI.

**Recommended generation parameters (from the [official docs](https://github.com/ideogram-oss/ideogram4/blob/main/docs/prompting.md)):**
- **Steps:** `12` for fast / `48` for quality
- **CFG:** ~`7`; optionally add a 1–3 step refiner pass at CFG `3`
- **Sampler / Scheduler:** defaults are fine
- **Resolution:** `1024` side length

## Installation

Clone this repository into SwarmUI's `src/Extensions/` folder and restart SwarmUI:

```
cd SwarmUI/src/Extensions
git clone https://github.com/your-username/SwarmUI-IdeogramPromptBuilder
```

SwarmUI will detect, build, and load the extension automatically on next launch.

## Credits

The Ideogram 4 structured caption schema and the original visual bounding-box builder concept are implemented in ComfyUI by **kijai** in the [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) project (`Ideogram4PromptBuilder` node). This SwarmUI extension is an independent port of that workflow into SwarmUI's tab/extension system.

## License

MIT
