/**
 * ideogram_builder.js
 * Ideogram 4 Prompt Builder – visual bounding-box canvas editor for
 * constructing structured JSON captions compatible with ideogram-ai/ideogram-4.
 *
 * Architecture:
 *   class IdeogramBuilder  – main singleton controller
 *   class IdeogramCanvas   – canvas interaction (draw / select / resize boxes)
 *   class IdeogramPalette  – palette-strip widgets (style + per-element)
 *
 * Key JSON schema (from the official prompting guide):
 *   high_level_description  (optional string)
 *   style_description       (optional object: photo or art_style variant)
 *   compositional_deconstruction  (required)
 *     background  (required string)
 *     elements    (required list – type, bbox?, desc, text?, color_palette?)
 *   bbox is [y_min, x_min, y_max, x_max] on a 0–1000 grid.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Palette helper
// ─────────────────────────────────────────────────────────────────────────────

class IdeogramPalette {
    /**
     * @param {HTMLElement} stripEl   - the .ideogram-palette-strip container
     * @param {number}      maxColors - maximum allowed swatches
     * @param {Function}    onChange  - called when palette changes
     */
    constructor(stripEl, maxColors, onChange) {
        this.strip = stripEl;
        this.max = maxColors;
        this.onChange = onChange;
        this.colors = [];
    }

    /** Returns the current list of uppercase hex strings. */
    getColors() {
        return this.colors.filter(c => c).map(c => c.toUpperCase());
    }

    /** Replaces current colors and re-renders. */
    setColors(list) {
        this.colors = (list || []).slice(0, this.max);
        this._render();
    }

    _render() {
        this.strip.innerHTML = '';
        for (let i = 0; i < this.colors.length; i++) {
            let swatch = document.createElement('div');
            swatch.className = 'ideogram-swatch';
            swatch.style.background = this.colors[i] || '#888888';
            swatch.title = this.colors[i] || '#888888';
            swatch.dataset.index = i;

            // Click to edit
            swatch.addEventListener('click', () => this._editSwatch(i));

            // Right-click to remove
            swatch.addEventListener('contextmenu', e => {
                e.preventDefault();
                this.colors.splice(i, 1);
                this._render();
                this.onChange();
            });

            this.strip.appendChild(swatch);
        }
    }

    _editSwatch(idx) {
        let input = document.createElement('input');
        input.type = 'color';
        input.value = this.colors[idx] || '#888888';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.click();
        input.addEventListener('input', () => {
            this.colors[idx] = input.value.toUpperCase();
            this._render();
            this.onChange();
        });
        input.addEventListener('change', () => {
            this.colors[idx] = input.value.toUpperCase();
            this._render();
            this.onChange();
            input.remove();
        });
        input.addEventListener('blur', () => input.remove());
    }

    /** Called by the '+' button. */
    addColor() {
        if (this.colors.length >= this.max) {
            return;
        }
        // Try to read a hex from clipboard
        navigator.clipboard.readText().then(text => {
            let hex = text.trim().toUpperCase();
            if (/^#[0-9A-F]{6}$/.test(hex)) {
                this.colors.push(hex);
                this._render();
                this.onChange();
            }
            else {
                this._pickNew();
            }
        }).catch(() => this._pickNew());
    }

    _pickNew() {
        let input = document.createElement('input');
        input.type = 'color';
        input.value = '#888888';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.click();
        input.addEventListener('change', () => {
            this.colors.push(input.value.toUpperCase());
            this._render();
            this.onChange();
            input.remove();
        });
        input.addEventListener('blur', () => input.remove());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas interaction
// ─────────────────────────────────────────────────────────────────────────────

class IdeogramCanvas {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Function} onBoxesChange   – called whenever box list changes
     * @param {Function} onSelectChange  – called when selection changes
     */
    constructor(canvas, onBoxesChange, onSelectChange) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onBoxesChange = onBoxesChange;
        this.onSelectChange = onSelectChange;
        this.boxes = [];          // Array of { x,y,w,h (0-1 fractions), type, desc, text, palette }
        this.selectedIdx = -1;
        this.dragState = null;    // { mode:'draw'|'move'|'resize', startX,startY, ... }
        this._handleBoxColors = [];

        canvas.addEventListener('mousedown', e => this._onMouseDown(e));
        canvas.addEventListener('mousemove', e => this._onMouseMove(e));
        canvas.addEventListener('mouseup',   e => this._onMouseUp(e));
        canvas.addEventListener('contextmenu', e => this._onContextMenu(e));
        canvas.addEventListener('dblclick',  e => this._onDblClick(e));
    }

    /** Convert a MouseEvent to canvas-relative fraction [0,1]. */
    _frac(e) {
        let rect = this.canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        };
    }

    /** Returns index of topmost box containing frac point, or -1. */
    _hitTest(fx, fy) {
        for (let i = this.boxes.length - 1; i >= 0; i--) {
            let b = this.boxes[i];
            let x1 = Math.min(b.x, b.x + b.w), x2 = Math.max(b.x, b.x + b.w);
            let y1 = Math.min(b.y, b.y + b.h), y2 = Math.max(b.y, b.y + b.h);
            if (fx >= x1 && fx <= x2 && fy >= y1 && fy <= y2) {
                return i;
            }
        }
        return -1;
    }

    /** Returns resize-handle side for selected box, or null. */
    _resizeHandle(fx, fy) {
        if (this.selectedIdx < 0) {
            return null;
        }
        let b = this.boxes[this.selectedIdx];
        let cw = this.canvas.width, ch = this.canvas.height;
        let px = fx * cw, py = fy * ch;
        let bx1 = Math.min(b.x, b.x + b.w) * cw;
        let by1 = Math.min(b.y, b.y + b.h) * ch;
        let bx2 = Math.max(b.x, b.x + b.w) * cw;
        let by2 = Math.max(b.y, b.y + b.h) * ch;
        let t = 10;
        if (px >= bx2 - t && px <= bx2 + t && py >= by2 - t && py <= by2 + t) {
            return 'se';
        }
        if (px >= bx1 - t && px <= bx1 + t && py >= by2 - t && py <= by2 + t) {
            return 'sw';
        }
        if (px >= bx2 - t && px <= bx2 + t && py >= by1 - t && py <= by1 + t) {
            return 'ne';
        }
        if (px >= bx1 - t && px <= bx1 + t && py >= by1 - t && py <= by1 + t) {
            return 'nw';
        }
        return null;
    }

    _onMouseDown(e) {
        e.preventDefault();
        let {x, y} = this._frac(e);
        let handle = this._resizeHandle(x, y);
        if (handle) {
            let b = this.boxes[this.selectedIdx];
            this.dragState = { mode: 'resize', handle, origBox: {...b}, startX: x, startY: y };
            return;
        }
        let hit = this._hitTest(x, y);
        if (hit >= 0 && !e.ctrlKey && !e.metaKey) {
            this.selectedIdx = hit;
            let b = this.boxes[hit];
            this.dragState = { mode: 'move', origBox: {...b}, startX: x, startY: y };
            this.onSelectChange(hit);
            this._draw();
            return;
        }
        // Start drawing a new box
        this.dragState = { mode: 'draw', startX: x, startY: y, curX: x, curY: y };
    }

    _onMouseMove(e) {
        if (!this.dragState) {
            // Update cursor
            let {x, y} = this._frac(e);
            let handle = this._resizeHandle(x, y);
            if (handle) {
                this.canvas.style.cursor = handle + '-resize';
            }
            else if (this._hitTest(x, y) >= 0) {
                this.canvas.style.cursor = 'move';
            }
            else {
                this.canvas.style.cursor = 'crosshair';
            }
            return;
        }
        let {x, y} = this._frac(e);
        if (this.dragState.mode == 'draw') {
            this.dragState.curX = x;
            this.dragState.curY = y;
            this._draw();
        }
        else if (this.dragState.mode == 'move') {
            let dx = x - this.dragState.startX;
            let dy = y - this.dragState.startY;
            let b = this.boxes[this.selectedIdx];
            b.x = Math.max(0, Math.min(1 - Math.abs(b.w), this.dragState.origBox.x + dx));
            b.y = Math.max(0, Math.min(1 - Math.abs(b.h), this.dragState.origBox.y + dy));
            this._draw();
        }
        else if (this.dragState.mode == 'resize') {
            let dx = x - this.dragState.startX;
            let dy = y - this.dragState.startY;
            let ob = this.dragState.origBox;
            let b = this.boxes[this.selectedIdx];
            let h = this.dragState.handle;
            if (h.includes('e')) {
                b.w = Math.max(0.01, ob.w + dx);
            }
            if (h.includes('s')) {
                b.h = Math.max(0.01, ob.h + dy);
            }
            if (h.includes('w')) {
                let newW = ob.w - dx;
                b.x = ob.x + dx;
                b.w = Math.max(0.01, newW);
            }
            if (h.includes('n')) {
                let newH = ob.h - dy;
                b.y = ob.y + dy;
                b.h = Math.max(0.01, newH);
            }
            this._draw();
        }
    }

    _onMouseUp(e) {
        if (!this.dragState) {
            return;
        }
        let ds = this.dragState;
        this.dragState = null;
        if (ds.mode == 'draw') {
            let w = ds.curX - ds.startX;
            let h = ds.curY - ds.startY;
            if (Math.abs(w) > 0.01 && Math.abs(h) > 0.01) {
                let x = w < 0 ? ds.startX + w : ds.startX;
                let y = h < 0 ? ds.startY + h : ds.startY;
                let newBox = {
                    x, y,
                    w: Math.abs(w),
                    h: Math.abs(h),
                    type: 'obj',
                    desc: '',
                    text: '',
                    palette: []
                };
                this.boxes.push(newBox);
                this.selectedIdx = this.boxes.length - 1;
                this.onSelectChange(this.selectedIdx);
                this.onBoxesChange();
            }
        }
        else {
            this.onBoxesChange();
        }
        this._draw();
    }

    _onContextMenu(e) {
        e.preventDefault();
        let {x, y} = this._frac(e);
        let hit = this._hitTest(x, y);
        if (hit >= 0) {
            this.boxes.splice(hit, 1);
            if (this.selectedIdx >= this.boxes.length) {
                this.selectedIdx = this.boxes.length - 1;
            }
            this.onSelectChange(this.selectedIdx);
            this.onBoxesChange();
            this._draw();
        }
    }

    _onDblClick(e) {
        let {x, y} = this._frac(e);
        let hit = this._hitTest(x, y);
        if (hit >= 0) {
            this.selectedIdx = hit;
            this.onSelectChange(hit);
            this._draw();
            // Focus the description textarea in the editor panel
            let descEl = document.getElementById('ideogram_elem_desc');
            if (descEl) {
                descEl.focus();
            }
        }
    }

    /** Full repaint. */
    _draw() {
        let ctx = this.ctx;
        let cw = this.canvas.width, ch = this.canvas.height;
        ctx.clearRect(0, 0, cw, ch);

        // Background grid
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, cw, ch);
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        let step = cw / 10;
        for (let gx = step; gx < cw; gx += step) {
            ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke();
        }
        step = ch / 10;
        for (let gy = step; gy < ch; gy += step) {
            ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
        }

        // Draw boxes
        for (let i = 0; i < this.boxes.length; i++) {
            let b = this.boxes[i];
            let bx = Math.min(b.x, b.x + b.w) * cw;
            let by = Math.min(b.y, b.y + b.h) * ch;
            let bw = Math.abs(b.w) * cw;
            let bh = Math.abs(b.h) * ch;
            let isSelected = i == this.selectedIdx;
            let color = (b.palette && b.palette.length > 0) ? b.palette[0] : (b.type == 'text' ? '#e8a838' : '#4a9eff');

            ctx.strokeStyle = isSelected ? '#ffffff' : color;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.strokeRect(bx, by, bw, bh);

            // Semi-transparent fill
            ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.06)' : 'rgba(74,158,255,0.04)';
            ctx.fillRect(bx, by, bw, bh);

            // Tag chip
            let tag = String(i + 1).padStart(2, '0');
            let typeLabel = b.type == 'text' ? 'T' : 'O';
            let chipText = `${tag} [${typeLabel}]`;
            ctx.font = 'bold 11px monospace';
            let chipW = ctx.measureText(chipText).width + 8;
            ctx.fillStyle = isSelected ? '#ffffff' : color;
            ctx.fillRect(bx, by, chipW, 18);
            ctx.fillStyle = isSelected ? '#000000' : '#000000';
            ctx.fillText(chipText, bx + 4, by + 13);

            // First line of description inside box
            if (bw > 40 && bh > 30) {
                let label = b.type == 'text' && b.text ? `"${b.text}"` : (b.desc ? b.desc.substring(0, 60) : '');
                if (label) {
                    ctx.font = '11px sans-serif';
                    ctx.fillStyle = isSelected ? '#ffffff' : '#cccccc';
                    ctx.fillText(label, bx + 4, by + 30, bw - 8);
                }
            }

            // Resize handle for selected
            if (isSelected) {
                let handles = [
                    [bx,      by],       // nw
                    [bx + bw, by],       // ne
                    [bx,      by + bh],  // sw
                    [bx + bw, by + bh],  // se
                ];
                ctx.fillStyle = '#ffffff';
                for (let [hx, hy] of handles) {
                    ctx.fillRect(hx - 5, hy - 5, 10, 10);
                }
            }
        }

        // Draw-in-progress box
        if (this.dragState && this.dragState.mode == 'draw') {
            let ds = this.dragState;
            let x = Math.min(ds.startX, ds.curX) * cw;
            let y = Math.min(ds.startY, ds.curY) * ch;
            let w = Math.abs(ds.curX - ds.startX) * cw;
            let h = Math.abs(ds.curY - ds.startY) * ch;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
        }
    }

    /** Public: resize canvas to fill wrapper. */
    resize(wrapperEl) {
        let w = wrapperEl.clientWidth;
        let h = wrapperEl.clientHeight;
        if (w < 10 || h < 10) {
            return;
        }
        this.canvas.width = w;
        this.canvas.height = h;
        this._draw();
    }

    /** Convert box fraction to 0-1000 Ideogram bbox [ymin, xmin, ymax, xmax]. */
    static normBbox(b) {
        let c = v => Math.max(0, Math.min(1000, Math.round(v * 1000)));
        let x1 = Math.min(b.x, b.x + b.w);
        let y1 = Math.min(b.y, b.y + b.h);
        let x2 = Math.max(b.x, b.x + b.w);
        let y2 = Math.max(b.y, b.y + b.h);
        return [c(y1), c(x1), c(y2), c(x2)];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main controller
// ─────────────────────────────────────────────────────────────────────────────

class IdeogramBuilder {
    constructor() {
        this._ready = false;
        // Palette instances
        this.stylePalette = null;
        this.elemPalette   = null;
        this.canvas        = null;
        // Extra fields list: [{key, value}]
        this.extraFields = [];
    }

    /** Called once, after the DOM (including the extension tab HTML) is ready. */
    init() {
        if (this._ready) {
            return;
        }
        // Check the tab container exists (it may not be loaded yet if the user
        // hasn't visited the tab yet – SwarmUI lazy-renders tabs)
        if (!document.getElementById('ideogram_builder_container')) {
            // Retry later
            setTimeout(() => this.init(), 500);
            return;
        }
        this._ready = true;
        this._bindElements();
        this._initCanvas();
        this._initPalettes();
        this._bindEvents();
        this._loadModels();
        this._updateStyleRows();
        this._renderElementList();
        this._updateJsonPreview();
    }

    _bindElements() {
        this.aspectSelect   = document.getElementById('ideogram_aspect_preset');
        this.customDims     = document.getElementById('ideogram_custom_dims');
        this.widthInput     = document.getElementById('ideogram_width');
        this.heightInput    = document.getElementById('ideogram_height');
        this.modelSelect    = document.getElementById('ideogram_model_select');
        this.redirectToggle = document.getElementById('ideogram_redirect_toggle');
        this.generateBtn    = document.getElementById('ideogram_generate_btn');
        this.statusSpan     = document.getElementById('ideogram_status');
        this.hldTextarea    = document.getElementById('ideogram_hld');
        this.styleType      = document.getElementById('ideogram_style_type');
        this.aesthetics     = document.getElementById('ideogram_aesthetics');
        this.lighting       = document.getElementById('ideogram_lighting');
        this.photoInput     = document.getElementById('ideogram_photo');
        this.artStyleInput  = document.getElementById('ideogram_art_style');
        this.mediumInput    = document.getElementById('ideogram_medium');
        this.bgTextarea     = document.getElementById('ideogram_background');
        this.elemList       = document.getElementById('ideogram_element_list');
        this.elemEditor     = document.getElementById('ideogram_element_editor');
        this.elemTypeSelect = document.getElementById('ideogram_elem_type');
        this.elemTextRow    = document.getElementById('ideogram_elem_text_row');
        this.elemTextInput  = document.getElementById('ideogram_elem_text');
        this.elemDescTA     = document.getElementById('ideogram_elem_desc');
        this.elemBboxDisplay= document.getElementById('ideogram_elem_bbox_display');
        this.addElementBtn  = document.getElementById('ideogram_add_element_btn');
        this.elemDeleteBtn  = document.getElementById('ideogram_elem_delete_btn');
        this.elemClearBboxBtn= document.getElementById('ideogram_elem_clear_bbox_btn');
        this.addExtraBtn    = document.getElementById('ideogram_add_extra_btn');
        this.extraFieldsDiv = document.getElementById('ideogram_extra_fields');
        this.jsonPreview    = document.getElementById('ideogram_json_preview');
        this.copyJsonBtn    = document.getElementById('ideogram_copy_json_btn');
        this.importJsonBtn  = document.getElementById('ideogram_import_json_btn');
        this.clearBoxesBtn  = document.getElementById('ideogram_clear_boxes_btn');
        this.resizeHandle   = document.getElementById('ideogram_resize_handle');
        this.sidebar        = document.getElementById('ideogram_sidebar');
        this.canvasWrapper  = document.getElementById('ideogram_canvas_wrapper');
    }

    _initCanvas() {
        let canvasEl = document.getElementById('ideogram_canvas');
        this.canvas = new IdeogramCanvas(
            canvasEl,
            () => { this._renderElementList(); this._updateJsonPreview(); this._syncEditorFromSelected(); },
            idx => { this._selectElement(idx); }
        );
        // Resize canvas once the tab is visible
        let resizeObs = new ResizeObserver(() => {
            let wrapper = document.getElementById('ideogram_canvas_wrapper');
            if (wrapper) {
                this.canvas.resize(wrapper);
            }
        });
        resizeObs.observe(this.canvasWrapper);
        // Also resize on tab click
        let tabBtn = document.getElementById('maintab_ideogram_prompt_builder');
        if (tabBtn) {
            tabBtn.addEventListener('click', () => {
                setTimeout(() => this.canvas.resize(this.canvasWrapper), 100);
            });
        }
    }

    _initPalettes() {
        this.stylePalette = new IdeogramPalette(
            document.getElementById('ideogram_style_palette'), 16, () => this._updateJsonPreview()
        );
        this.elemPalette = new IdeogramPalette(
            document.getElementById('ideogram_elem_palette'), 5, () => this._syncElemPaletteToBox()
        );

        // '+' buttons
        document.querySelectorAll('.ideogram-palette-add').forEach(btn => {
            btn.addEventListener('click', () => {
                let targetId = btn.getAttribute('data-target');
                if (targetId == 'ideogram_style_palette') {
                    this.stylePalette.addColor();
                }
                else if (targetId == 'ideogram_elem_palette') {
                    this.elemPalette.addColor();
                }
            });
        });
    }

    _bindEvents() {
        // Aspect ratio preset
        this.aspectSelect.addEventListener('change', () => {
            if (this.aspectSelect.value == 'custom') {
                this.customDims.style.display = '';
            }
            else {
                this.customDims.style.display = 'none';
                let [w, h] = this.aspectSelect.value.split('x').map(Number);
                this.widthInput.value  = w;
                this.heightInput.value = h;
            }
            this._resizeCanvasToAspect();
        });
        this.widthInput.addEventListener('input',  () => this._resizeCanvasToAspect());
        this.heightInput.addEventListener('input', () => this._resizeCanvasToAspect());

        // Style type
        this.styleType.addEventListener('change', () => { this._updateStyleRows(); this._updateJsonPreview(); });

        // Text fields
        let liveUpdate = [this.hldTextarea, this.aesthetics, this.lighting, this.photoInput,
                          this.artStyleInput, this.mediumInput, this.bgTextarea];
        for (let el of liveUpdate) {
            el.addEventListener('input', () => this._updateJsonPreview());
        }

        // Generate button
        this.generateBtn.addEventListener('click', () => this._doGenerate());

        // Add element
        this.addElementBtn.addEventListener('click', () => this._addUnplacedElement());

        // Element editor
        this.elemTypeSelect.addEventListener('change', () => {
            this._updateElemTextRow();
            this._syncEditorToBox();
        });
        this.elemTextInput.addEventListener('input', () => this._syncEditorToBox());
        this.elemDescTA.addEventListener('input',    () => this._syncEditorToBox());
        this.elemDeleteBtn.addEventListener('click', () => this._deleteSelectedElement());
        this.elemClearBboxBtn.addEventListener('click', () => this._clearSelectedBbox());

        // Extra fields
        this.addExtraBtn.addEventListener('click', () => this._addExtraField());

        // JSON copy / import
        this.copyJsonBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.jsonPreview.textContent).then(() => {
                this._setStatus('JSON copied!', 1500);
            });
        });
        this.importJsonBtn.addEventListener('click', () => this._importFromClipboard());

        // Clear boxes
        this.clearBoxesBtn.addEventListener('click', () => {
            if (confirm('Clear all bounding boxes?')) {
                this.canvas.boxes = [];
                this.canvas.selectedIdx = -1;
                this.canvas._draw();
                this._selectElement(-1);
                this._renderElementList();
                this._updateJsonPreview();
            }
        });

        // Sidebar resize handle
        this._bindSidebarResize();
    }

    _bindSidebarResize() {
        let dragging = false, startX = 0, startW = 0;
        this.resizeHandle.addEventListener('mousedown', e => {
            dragging = true;
            startX = e.clientX;
            startW = this.sidebar.offsetWidth;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) {
                return;
            }
            let newW = Math.max(260, Math.min(600, startW + (e.clientX - startX)));
            this.sidebar.style.width = newW + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) {
                return;
            }
            dragging = false;
            document.body.style.cursor = '';
            this.canvas.resize(this.canvasWrapper);
        });
    }

    // ── Model loading ─────────────────────────────────────────────────────────

    _loadModels() {
        // Populate model dropdown from SwarmUI's model list (diffusion_models / Stable-Diffusion)
        let populate = () => {
            let names = [];
            if (typeof modelsHelpers !== 'undefined') {
                // Try diffusion_models first (Flux / newer models)
                let dm = modelsHelpers.listModelNames('diffusion_models');
                let sd = modelsHelpers.listModelNames('Stable-Diffusion');
                names = [...new Set([...dm, ...sd])].sort();
            }
            let sel = this.modelSelect;
            let prev = sel.value;
            sel.innerHTML = '<option value="">— select model —</option>';
            for (let name of names) {
                let opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                sel.appendChild(opt);
            }
            if (prev && names.includes(prev)) {
                sel.value = prev;
            }
            // Also set to current model if one is already selected
            let curModelEl = document.getElementById('current_model');
            if (curModelEl && curModelEl.value && !sel.value) {
                sel.value = curModelEl.value;
            }
        };
        // Models may not be loaded yet; retry until available
        let attempts = 0;
        let tryPopulate = () => {
            if (typeof modelsHelpers !== 'undefined' &&
                (modelsHelpers.listModelNames('diffusion_models').length > 0 ||
                 modelsHelpers.listModelNames('Stable-Diffusion').length > 0)) {
                populate();
            }
            else if (attempts++ < 30) {
                setTimeout(tryPopulate, 1000);
            }
        };
        tryPopulate();
    }

    // ── Style rows ────────────────────────────────────────────────────────────

    _updateStyleRows() {
        let kind = this.styleType.value;
        document.getElementById('ideogram_photo_row').style.display     = kind == 'photo'     ? '' : 'none';
        document.getElementById('ideogram_artstyle_row').style.display  = kind == 'art_style' ? '' : 'none';
    }

    // ── Aspect ratio / canvas sizing ──────────────────────────────────────────

    _getWidthHeight() {
        let w = parseInt(this.widthInput.value)  || 1024;
        let h = parseInt(this.heightInput.value) || 1024;
        return { w, h };
    }

    _resizeCanvasToAspect() {
        // Keep canvas visually proportional to the chosen aspect ratio
        let {w, h} = this._getWidthHeight();
        let wrapper = this.canvasWrapper;
        if (!wrapper) {
            return;
        }
        let maxW = wrapper.clientWidth  || 512;
        let maxH = wrapper.clientHeight || 512;
        let scale = Math.min(maxW / w, maxH / h, 1);
        this.canvas.canvas.width  = Math.round(w * scale);
        this.canvas.canvas.height = Math.round(h * scale);
        this.canvas._draw();
    }

    // ── Element management ────────────────────────────────────────────────────

    _addUnplacedElement() {
        this.canvas.boxes.push({ x:0, y:0, w:0, h:0, type:'obj', desc:'', text:'', palette:[], nobbox:true });
        let idx = this.canvas.boxes.length - 1;
        this.canvas.selectedIdx = idx;
        this._renderElementList();
        this._selectElement(idx);
        this._updateJsonPreview();
    }

    _selectElement(idx) {
        this.canvas.selectedIdx = idx;
        this.canvas._draw();
        if (idx < 0 || idx >= this.canvas.boxes.length) {
            this.elemEditor.style.display = 'none';
            return;
        }
        let b = this.canvas.boxes[idx];
        this.elemEditor.style.display = '';
        this.elemTypeSelect.value = b.type || 'obj';
        this.elemTextInput.value  = b.text || '';
        this.elemDescTA.value     = b.desc || '';
        this.elemPalette.setColors(b.palette || []);
        this._updateElemTextRow();
        this._updateBboxDisplay();
        // Highlight in list
        let items = this.elemList.querySelectorAll('.ideogram-elem-list-item');
        items.forEach((item, i) => {
            item.classList.toggle('ideogram-elem-selected', i == idx);
        });
    }

    _syncEditorToBox() {
        let idx = this.canvas.selectedIdx;
        if (idx < 0 || idx >= this.canvas.boxes.length) {
            return;
        }
        let b = this.canvas.boxes[idx];
        b.type = this.elemTypeSelect.value;
        b.text = this.elemTextInput.value;
        b.desc = this.elemDescTA.value;
        this.canvas._draw();
        this._renderElementList();
        this._updateJsonPreview();
        this._updateBboxDisplay();
    }

    _syncEditorFromSelected() {
        let idx = this.canvas.selectedIdx;
        if (idx < 0 || idx >= this.canvas.boxes.length) {
            return;
        }
        let b = this.canvas.boxes[idx];
        this.elemTypeSelect.value = b.type || 'obj';
        this.elemTextInput.value  = b.text || '';
        this.elemDescTA.value     = b.desc || '';
        this._updateElemTextRow();
        this._updateBboxDisplay();
    }

    _syncElemPaletteToBox() {
        let idx = this.canvas.selectedIdx;
        if (idx < 0 || idx >= this.canvas.boxes.length) {
            return;
        }
        this.canvas.boxes[idx].palette = this.elemPalette.getColors();
        this._updateJsonPreview();
    }

    _updateElemTextRow() {
        this.elemTextRow.style.display = this.elemTypeSelect.value == 'text' ? '' : 'none';
    }

    _updateBboxDisplay() {
        let idx = this.canvas.selectedIdx;
        if (idx < 0 || idx >= this.canvas.boxes.length) {
            this.elemBboxDisplay.textContent = '—';
            return;
        }
        let b = this.canvas.boxes[idx];
        if (b.nobbox || (b.w == 0 && b.h == 0)) {
            this.elemBboxDisplay.textContent = '(no bbox)';
        }
        else {
            let bbox = IdeogramCanvas.normBbox(b);
            this.elemBboxDisplay.textContent = `[${bbox.join(', ')}]`;
        }
    }

    _deleteSelectedElement() {
        let idx = this.canvas.selectedIdx;
        if (idx < 0 || idx >= this.canvas.boxes.length) {
            return;
        }
        this.canvas.boxes.splice(idx, 1);
        this.canvas.selectedIdx = this.canvas.boxes.length > 0 ? Math.min(idx, this.canvas.boxes.length - 1) : -1;
        this.canvas._draw();
        this._selectElement(this.canvas.selectedIdx);
        this._renderElementList();
        this._updateJsonPreview();
    }

    _clearSelectedBbox() {
        let idx = this.canvas.selectedIdx;
        if (idx < 0 || idx >= this.canvas.boxes.length) {
            return;
        }
        let b = this.canvas.boxes[idx];
        b.nobbox = true;
        b.x = b.y = b.w = b.h = 0;
        this.canvas._draw();
        this._updateBboxDisplay();
        this._updateJsonPreview();
    }

    _renderElementList() {
        this.elemList.innerHTML = '';
        let boxes = this.canvas.boxes;
        for (let i = 0; i < boxes.length; i++) {
            let b = boxes[i];
            let item = document.createElement('div');
            item.className = 'ideogram-elem-list-item';
            if (i == this.canvas.selectedIdx) {
                item.classList.add('ideogram-elem-selected');
            }
            let tag = String(i + 1).padStart(2, '0');
            let typeLabel = b.type == 'text' ? '[T]' : '[O]';
            let summary = b.type == 'text' && b.text
                ? `"${b.text.substring(0, 30)}"`
                : (b.desc ? b.desc.substring(0, 40) : '(no description)');
            item.innerHTML = `<span class="ideogram-elem-tag">${tag} ${typeLabel}</span> <span class="ideogram-elem-summary">${escapeHtml(summary)}</span>`;
            item.addEventListener('click', () => {
                this._selectElement(i);
                this.canvas._draw();
            });
            this.elemList.appendChild(item);
        }
        if (boxes.length == 0) {
            this.elemList.innerHTML = '<div class="ideogram-empty-hint">Draw bounding boxes on the canvas, or click "+ Add".</div>';
        }
    }

    // ── Extra fields ──────────────────────────────────────────────────────────

    _addExtraField(key = '', value = '') {
        let row = document.createElement('div');
        row.className = 'ideogram-extra-row';
        let keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'ideogram-input ideogram-extra-key';
        keyInput.placeholder = 'key';
        keyInput.value = key;
        let valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'ideogram-input ideogram-extra-val';
        valInput.placeholder = 'value';
        valInput.value = value;
        let delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.className = 'ideogram-icon-btn danger';
        delBtn.addEventListener('click', () => {
            row.remove();
            this._updateJsonPreview();
        });
        keyInput.addEventListener('input', () => this._updateJsonPreview());
        valInput.addEventListener('input', () => this._updateJsonPreview());
        row.appendChild(keyInput);
        row.appendChild(valInput);
        row.appendChild(delBtn);
        this.extraFieldsDiv.appendChild(row);
        this._updateJsonPreview();
    }

    _getExtraFields() {
        let result = {};
        this.extraFieldsDiv.querySelectorAll('.ideogram-extra-row').forEach(row => {
            let k = row.querySelector('.ideogram-extra-key').value.trim();
            let v = row.querySelector('.ideogram-extra-val').value.trim();
            if (k) {
                result[k] = v;
            }
        });
        return result;
    }

    // ── JSON construction ─────────────────────────────────────────────────────

    _buildCaption() {
        let caption = {};
        let hld = this.hldTextarea.value.trim();
        if (hld) {
            caption.high_level_description = hld;
        }
        let kind = this.styleType.value;
        if (kind != 'none') {
            let sd = {
                aesthetics: this.aesthetics.value.trim(),
                lighting:   this.lighting.value.trim()
            };
            if (kind == 'photo') {
                sd.photo  = this.photoInput.value.trim();
                sd.medium = this.mediumInput.value.trim();
            }
            else {
                sd.medium    = this.mediumInput.value.trim();
                sd.art_style = this.artStyleInput.value.trim();
            }
            let pal = this.stylePalette.getColors();
            if (pal.length > 0) {
                sd.color_palette = pal;
            }
            caption.style_description = sd;
        }
        let elements = [];
        for (let b of this.canvas.boxes) {
            if (!b || typeof b !== 'object') {
                continue;
            }
            let etype = b.type == 'text' ? 'text' : 'obj';
            let elem = { type: etype };
            if (!b.nobbox && (b.w != 0 || b.h != 0)) {
                elem.bbox = IdeogramCanvas.normBbox(b);
            }
            if (etype == 'text') {
                elem.text = b.text || '';
            }
            elem.desc = b.desc || '';
            let pal = (b.palette || []).filter(c => c).map(c => c.toUpperCase()).slice(0, 5);
            if (pal.length > 0) {
                elem.color_palette = pal;
            }
            elements.push(elem);
        }
        caption.compositional_deconstruction = {
            background: this.bgTextarea.value.trim(),
            elements
        };
        // Merge extra fields
        let extras = this._getExtraFields();
        for (let k in extras) {
            caption[k] = extras[k];
        }
        return caption;
    }

    _dumpJson(v, lvl = 0) {
        let pad = '    '.repeat(lvl + 1);
        let end = '    '.repeat(lvl);
        if (typeof v === 'string') {
            return JSON.stringify(v);
        }
        if (Array.isArray(v)) {
            if (v.length == 0) {
                return '[]';
            }
            if (v.every(x => typeof x !== 'object' || x === null)) {
                return '[' + v.map(x => this._dumpJson(x, lvl)).join(', ') + ']';
            }
            return '[\n' + v.map(x => pad + this._dumpJson(x, lvl + 1)).join(',\n') + '\n' + end + ']';
        }
        if (typeof v === 'object' && v !== null) {
            if (Object.keys(v).length == 0) {
                return '{}';
            }
            let items = Object.entries(v).map(([k, val]) => pad + JSON.stringify(k) + ': ' + this._dumpJson(val, lvl + 1));
            return '{\n' + items.join(',\n') + '\n' + end + '}';
        }
        return JSON.stringify(v);
    }

    _updateJsonPreview() {
        let caption = this._buildCaption();
        this.jsonPreview.textContent = this._dumpJson(caption);
    }

    // ── Import ────────────────────────────────────────────────────────────────

    _importFromClipboard() {
        navigator.clipboard.readText().then(text => {
            try {
                let caption = JSON.parse(text);
                this._loadCaption(caption);
                this._setStatus('Imported from clipboard.', 2000);
            }
            catch (e) {
                this._setStatus('Clipboard does not contain valid JSON.', 2500);
            }
        }).catch(() => {
            this._setStatus('Could not read clipboard.', 2000);
        });
    }

    _loadCaption(caption) {
        if (!caption || typeof caption !== 'object') {
            return;
        }
        this.hldTextarea.value = caption.high_level_description || '';
        let sd = caption.style_description;
        if (sd) {
            if ('photo' in sd) {
                this.styleType.value = 'photo';
                this.photoInput.value = sd.photo || '';
            }
            else if ('art_style' in sd) {
                this.styleType.value = 'art_style';
                this.artStyleInput.value = sd.art_style || '';
            }
            this.aesthetics.value = sd.aesthetics || '';
            this.lighting.value   = sd.lighting   || '';
            this.mediumInput.value= sd.medium     || '';
            this.stylePalette.setColors(sd.color_palette || []);
        }
        else {
            this.styleType.value = 'none';
        }
        this._updateStyleRows();
        let cd = caption.compositional_deconstruction;
        if (cd) {
            this.bgTextarea.value = cd.background || '';
            this.canvas.boxes = [];
            for (let elem of (cd.elements || [])) {
                let box = {
                    type: elem.type || 'obj',
                    desc: elem.desc || '',
                    text: elem.text || '',
                    palette: elem.color_palette || [],
                    nobbox: !elem.bbox,
                    x: 0, y: 0, w: 0, h: 0
                };
                if (elem.bbox && elem.bbox.length == 4) {
                    // [ymin, xmin, ymax, xmax] on 0-1000 -> fractions
                    let [ymin, xmin, ymax, xmax] = elem.bbox.map(v => v / 1000);
                    box.x = xmin;
                    box.y = ymin;
                    box.w = xmax - xmin;
                    box.h = ymax - ymin;
                    box.nobbox = false;
                }
                this.canvas.boxes.push(box);
            }
            this.canvas.selectedIdx = -1;
            this.canvas._draw();
        }
        this._renderElementList();
        this._selectElement(-1);
        this._updateJsonPreview();
    }

    // ── Generate ──────────────────────────────────────────────────────────────

    _doGenerate() {
        let modelName = this.modelSelect.value;
        if (!modelName) {
            this._setStatus('Please select a model first.', 2500);
            return;
        }
        let caption = this._buildCaption();
        let promptStr = this._dumpJson(caption);
        let {w, h} = this._getWidthHeight();
        let redirect = this.redirectToggle.checked;

        // Build input overrides – these override whatever is set in the Generate tab
        let overrides = {
            prompt: promptStr,
            width:  w,
            height: h,
            images: 1
        };

        // Set the model via the existing current_model element so SwarmUI picks it up
        let curModelEl = document.getElementById('current_model');
        if (curModelEl) {
            curModelEl.value = modelName;
            // Trigger change event so SwarmUI updates internal state
            curModelEl.dispatchEvent(new Event('change'));
        }

        this._setStatus('Queuing generation…');

        // Give SwarmUI a tick to process the model change, then generate
        setTimeout(() => {
            if (typeof mainGenHandler !== 'undefined') {
                mainGenHandler.doGenerate(overrides);
                this._setStatus('Generation queued.', 2000);
                if (redirect) {
                    let generateTab = document.getElementById('maintab_generate');
                    if (generateTab) {
                        generateTab.click();
                    }
                }
            }
            else {
                this._setStatus('Error: SwarmUI generate handler not ready.', 3000);
            }
        }, 100);
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    _setStatus(msg, clearAfterMs = 0) {
        this.statusSpan.textContent = msg;
        if (clearAfterMs > 0) {
            setTimeout(() => { this.statusSpan.textContent = ''; }, clearAfterMs);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

let ideogramBuilder = new IdeogramBuilder();

// Init when the page is ready.  The tab content may not exist immediately,
// so we watch for it and also hook into tab-click events.
function _ideogramTryInit() {
    if (document.readyState == 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(() => ideogramBuilder.init(), 300));
    }
    else {
        setTimeout(() => ideogramBuilder.init(), 300);
    }
}
_ideogramTryInit();

// Also re-init when the user first clicks the tab (lazy render).
document.addEventListener('click', function _ideogramTabClick(e) {
    if (e.target && (e.target.id == 'maintab_ideogram_prompt_builder' || e.target.closest('#maintab_ideogram_prompt_builder'))) {
        setTimeout(() => ideogramBuilder.init(), 200);
    }
});
