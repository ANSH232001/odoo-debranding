/** @odoo-module **/

import { registry } from "@web/core/registry";
import {
    Component, useState, useRef, onMounted, onWillUnmount, onWillUpdateProps,
} from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { isBinarySize } from "@web/core/utils/binary";

// ─── Binary helpers ───────────────────────────────────────────────────────────

function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

function uint8ArrayToBase64(arr) {
    let bin = '';
    for (let i = 0; i < arr.length; i += 8192) {
        bin += String.fromCharCode(...arr.subarray(i, i + 8192));
    }
    return btoa(bin);
}

// ─── Parse row heights directly from the XLSX ZIP ────────────────────────────
// SheetJS may not populate ws['!rows'][r].hpt for every row depending on
// options/version. Reading heights directly from the raw XML is more reliable.
// Returns a plain object: { rowIndex(0-based): pixelHeight }.

async function parseRowHeightsFromZip(bytes) {
    const heights = {};
    try {
        const zip   = await JSZip.loadAsync(bytes);
        const file  = zip.file('xl/worksheets/sheet1.xml');
        if (!file) return heights;
        const xml   = await file.async('string');
        const doc   = new DOMParser().parseFromString(xml, 'text/xml');
        const rowEls = doc.getElementsByTagNameNS(SS_NS, 'row');
        for (const rowEl of Array.from(rowEls)) {
            const r      = parseInt(rowEl.getAttribute('r')) - 1; // 0-indexed
            const hidden = rowEl.getAttribute('hidden') === '1';
            if (hidden) {
                heights[r] = 0; // hidden rows must render as 0px
                continue;
            }
            const ht = parseFloat(rowEl.getAttribute('ht') || '0');
            if (ht > 0) heights[r] = Math.round(ht * 1.333); // pt → px at 96 DPI
        }
    } catch (e) {
        console.warn('[ExcelViewer] row height ZIP parse failed:', e);
    }
    return heights;
}

// ─── Build cumulative pixel positions for every column and row ────────────────
// colPos[c] = left-edge pixel of column c (0 = column A)
// rowPos[r] = top-edge pixel of row r  (0 = row 1 in Excel / row 0 in SheetJS)
//
// zipRowHeights: result of parseRowHeightsFromZip — preferred over SheetJS data
// because SheetJS may silently skip rows without customHeight="1".

function buildPositions(ws, zipRowHeights = {}) {
    if (!ws['!ref']) return { colPos: [0], rowPos: [0] };
    const range = XLSX.utils.decode_range(ws['!ref']);
    const cols  = ws['!cols'] || [];
    const rows  = ws['!rows'] || [];

    // Default row height from sheetFormatPr (pt → px); fall back to 15pt = 20px
    const defHPt  = ws['!sheetFormat']?.defaultRowHeight ?? 15;
    const defHPx  = Math.round(defHPt * 1.333);

    const colPos = [0];
    for (let c = 0; c <= range.e.c; c++) {
        const col = cols[c] || {};
        // wpx is computed by SheetJS; fall back to character-width × 7 px
        const w = col.wpx ? col.wpx : col.wch ? Math.round(col.wch * 7) : 64;
        colPos.push(colPos[c] + w);
    }

    const rowPos = [0];
    for (let r = 0; r <= range.e.r; r++) {
        let h = zipRowHeights[r];             // direct from ZIP XML (most reliable)
        if (!h) {
            const row = rows[r] || {};
            h = row.hpx ? row.hpx            // SheetJS pixel height
              : row.hpt ? Math.round(row.hpt * 1.333)  // SheetJS pt height
              : defHPx;                       // sheet default
        }
        rowPos.push(rowPos[r] + h);
    }

    return { colPos, rowPos };
}

// ─── Build HTML table matching the Excel layout ───────────────────────────────
// Adds data-r / data-c attributes so cells can be identified on save.
//
// Two critical fixes for sheets with large merged cells:
//  1. Merged cell height = sum of all spanned rows (not just the first row).
//  2. Rows where every cell is a skip-cell (covered by a merge from above) get
//     an invisible zero-width spacer <td> so the row doesn't collapse to 0px.

function buildHtmlTable(ws, colPos, rowPos) {
    if (!ws['!ref']) return '<table></table>';
    const range  = XLSX.utils.decode_range(ws['!ref']);
    const merges = ws['!merges'] || [];

    const skipCells = new Set();
    const mergeMap  = {};
    for (const m of merges) {
        mergeMap[`${m.s.r},${m.s.c}`] = { colspan: m.e.c - m.s.c + 1, rowspan: m.e.r - m.s.r + 1 };
        for (let r = m.s.r; r <= m.e.r; r++)
            for (let c = m.s.c; c <= m.e.c; c++)
                if (r !== m.s.r || c !== m.s.c) skipCells.add(`${r},${c}`);
    }

    let cg = '<colgroup>';
    for (let c = range.s.c; c <= range.e.c; c++)
        cg += `<col style="width:${colPos[c + 1] - colPos[c]}px">`;
    cg += '</colgroup>';

    let tbody = '';
    for (let r = range.s.r; r <= range.e.r; r++) {
        const h = rowPos[r + 1] - rowPos[r];

        // Hidden rows (h === 0): render with no height and no borders so they
        // truly take 0px in the layout (image overlays skip over them correctly).
        if (h === 0) {
            tbody += `<tr style="height:0px;line-height:0;overflow:hidden;">`;
            tbody += `<td colspan="${range.e.c - range.s.c + 1}" `
                   + `style="height:0;padding:0;border:none;font-size:0;line-height:0;overflow:hidden;"></td>`;
            tbody += '</tr>';
            continue;
        }

        tbody += `<tr style="height:${h}px">`;
        let anyCellAdded = false;

        for (let c = range.s.c; c <= range.e.c; c++) {
            if (skipCells.has(`${r},${c}`)) continue;
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            let text = '';
            if (cell) {
                text = cell.w !== undefined
                    ? cell.w
                    : (cell.v !== undefined && cell.v !== null ? String(cell.v) : '');
                text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
            const mi  = mergeMap[`${r},${c}`];
            const cs  = mi && mi.colspan > 1 ? ` colspan="${mi.colspan}"` : '';
            const rs  = mi && mi.rowspan > 1 ? ` rowspan="${mi.rowspan}"` : '';

            // For rowspan > 1, the cell must be tall enough to cover all spanned rows
            // so the image overlay aligns correctly with the row positions.
            let cellH = h;
            if (mi && mi.rowspan > 1) {
                cellH = rowPos[r + mi.rowspan] - rowPos[r];
            }

            const cellStyle = `height:${cellH}px;padding:1px 3px;overflow:hidden;white-space:nowrap;`
                            + `vertical-align:middle;border-right:1px solid #d0d0d0;border-bottom:1px solid #d0d0d0;`
                            + `border-top:none;border-left:none;box-sizing:border-box;`;

            tbody += `<td${cs}${rs} data-r="${r}" data-c="${c}" style="${cellStyle}">`
                   + `${text}</td>`;
            anyCellAdded = true;
        }

        // If every cell in this row is a skip-cell (covered by a merge that started
        // above), add an invisible zero-width spacer so the <tr> doesn't collapse.
        if (!anyCellAdded) {
            tbody += `<td style="padding:0;border:none;height:${h}px;width:0;`
                   + `min-width:0;max-width:0;overflow:hidden;font-size:0;line-height:0;"></td>`;
        }

        tbody += '</tr>';
    }

    return `<table style="border-collapse:separate;border-spacing:0;table-layout:fixed;`
         + `font-family:Calibri,Arial,sans-serif;font-size:11px;">`
         + `${cg}<tbody>${tbody}</tbody></table>`;
}

// ─── Read actual rendered row positions from a mounted table ──────────────────
// After the table is in the DOM, tr.offsetTop gives the true Y position
// accounting for border-collapse, box-sizing, and any browser layout quirks.
// Returns an array matching the rowPos contract: pos[r] = top of row r (px),
// pos[r+1] = bottom of row r = top of row r+1.

function buildDomRowPos(wrapper) {
    const table = wrapper.querySelector('table');
    if (!table) return [];
    const trs = table.querySelectorAll('tbody tr');
    if (!trs.length) return [];
    const pos = [];
    for (const tr of trs) {
        pos.push(tr.offsetTop);
    }
    const last = trs[trs.length - 1];
    pos.push(last.offsetTop + last.offsetHeight);
    return pos;
}

// ─── Read actual rendered column positions from a mounted table ───────────────
// <col> elements in modern browsers support getBoundingClientRect(), so we can
// measure each column's actual rendered width after the browser has laid out
// the table. This eliminates X-drift from fractional SheetJS wpx values that
// accumulate over many columns (18+ columns → several pixels of error).
// Falls back to calculated colPos if the browser returns zero-width cols.

function buildDomColPos(wrapper) {
    const table = wrapper.querySelector('table');
    if (!table) return [];
    const colEls = Array.from(table.querySelectorAll('col'));
    if (colEls.length < 2) return [];
    const rects = colEls.map(c => c.getBoundingClientRect());
    // Sanity check: browser must return non-zero widths for col elements
    if (rects[0].width === 0) return [];
    // Build positions by summing actual rendered column widths.
    // Summing widths (not using absolute left coords) avoids sub-pixel drift
    // from rounding differences between getBoundingClientRect and the table origin.
    // Accumulate raw (unrounded) widths before rounding to avoid sub-pixel drift
    // that compounds across many columns (e.g. 20 cols × 0.5px = 10px error at right edge).
    const pos = [0];
    let sum = 0;
    for (const r of rects) {
        sum += r.width;
        pos.push(Math.round(sum));
    }
    return pos;
}

// ─── Extract images from XLSX ZIP (with precise EMU offsets) ──────────────────
// OOXML positions images using cell anchors + EMU (English Metric Units) offsets.
// 1 px = 9144 EMU at 96 DPI.

const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG  = 'http://schemas.openxmlformats.org/package/2006/relationships';
const EMU_PER_PX = 9144;

function emuToPx(emuStr) {
    const n = parseInt(emuStr || '0', 10);
    return isNaN(n) ? 0 : n / EMU_PER_PX;
}

async function extractImages(bytes, colPos, rowPos) {
    let zip;
    try { zip = await JSZip.loadAsync(bytes); }
    catch { return []; }

    const drawFile = zip.file('xl/drawings/drawing1.xml');
    const relsFile = zip.file('xl/drawings/_rels/drawing1.xml.rels');
    if (!drawFile || !relsFile) return [];

    const [drawXml, relsXml] = await Promise.all([
        drawFile.async('string'),
        relsFile.async('string'),
    ]);

    const parser = new DOMParser();

    // Map rId → image path inside the ZIP
    const rIdToPath = {};
    for (const rel of Array.from(
        parser.parseFromString(relsXml, 'text/xml').getElementsByTagNameNS(PKG, 'Relationship')
    )) {
        const target = rel.getAttribute('Target'); // e.g. '../media/image00001.png'
        rIdToPath[rel.getAttribute('Id')] = 'xl/media/' + target.split('/').pop();
    }

    const anchors = Array.from(
        parser.parseFromString(drawXml, 'text/xml').getElementsByTagNameNS(XDR, 'twoCellAnchor')
    );

    const imgCache = {};
    const images   = [];

    for (const anchor of anchors) {
        const fromEl = anchor.getElementsByTagNameNS(XDR, 'from')[0];
        const toEl   = anchor.getElementsByTagNameNS(XDR, 'to')[0];
        const blip   = anchor.getElementsByTagNameNS(A_NS, 'blip')[0];
        if (!fromEl || !toEl || !blip) continue;

        const rId  = blip.getAttributeNS(R_NS, 'embed');
        const path = rIdToPath[rId];
        if (!path) continue;

        if (!imgCache[path]) {
            const f = zip.file(path);
            if (!f) continue;
            const ext  = path.split('.').pop().toLowerCase();
            const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
            imgCache[path] = `data:${mime};base64,${uint8ArrayToBase64(await f.async('uint8array'))}`;
        }

        const getInt = (el, tag) => parseInt(el.getElementsByTagNameNS(XDR, tag)[0]?.textContent || '0');

        const fromCol    = getInt(fromEl, 'col');
        const fromColOff = emuToPx(fromEl.getElementsByTagNameNS(XDR, 'colOff')[0]?.textContent);
        const fromRow    = getInt(fromEl, 'row');
        const fromRowOff = emuToPx(fromEl.getElementsByTagNameNS(XDR, 'rowOff')[0]?.textContent);
        const toCol      = getInt(toEl,   'col');
        const toColOff   = emuToPx(toEl.getElementsByTagNameNS(XDR, 'colOff')[0]?.textContent);
        const toRow      = getInt(toEl,   'row');
        const toRowOff   = emuToPx(toEl.getElementsByTagNameNS(XDR, 'rowOff')[0]?.textContent);

        const left   = (colPos[fromCol] ?? 0) + fromColOff;
        const top    = (rowPos[fromRow] ?? 0) + fromRowOff;
        const right  = (colPos[toCol]   ?? colPos[colPos.length - 1]) + toColOff;
        const bottom = (rowPos[toRow]   ?? rowPos[rowPos.length - 1]) + toRowOff;

        if (right > left && bottom > top)
            images.push({
                src:      imgCache[path],
                left:     Math.round(left),
                top:      Math.round(top),
                width:    Math.round(right  - left),
                height:   Math.round(bottom - top),
                fromCol,
            });
    }

    // Normalize widths: images that share the same fromCol belong to the same
    // visual group (separator, label strip, nesting diagram all start at col 0).
    // Use the tallest image's width as the reference — the nesting diagram
    // (tallest) has the authoritative content width; separator and label strip
    // may compute differently due to toColOff artifacts.
    const refWidthByCol = new Map();
    for (const img of images) {
        const cur = refWidthByCol.get(img.fromCol);
        if (!cur || img.height > cur.height)
            refWidthByCol.set(img.fromCol, { width: img.width, height: img.height });
    }
    for (const img of images)
        img.width = refWidthByCol.get(img.fromCol).width;

    return images;
}

// ─── Save: update cell values in the original XLSX, preserving images ─────────
// Instead of writing a new XLSX (which loses drawings), we open the original
// ZIP with JSZip, update only the worksheet XML for changed cells, and re-zip.
//
// changedCells: Map of "R,C" → newText (only cells the user actually changed)

const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

async function saveWithImagesPreserved(originalBytes, changedCells) {
    if (!changedCells.size) return null; // nothing changed

    const zip    = await JSZip.loadAsync(originalBytes);
    const parser = new DOMParser();
    const ser    = new XMLSerializer();

    // ── Shared strings ────────────────────────────────────────────────────────
    const ssFile = zip.file('xl/sharedStrings.xml');
    const strings = [];   // index → string value
    const ssIdx   = {};   // string → index
    let ssDoc     = null;

    if (ssFile) {
        ssDoc = parser.parseFromString(await ssFile.async('string'), 'text/xml');
        const sis = ssDoc.getElementsByTagNameNS(SS_NS, 'si');
        for (let i = 0; i < sis.length; i++) {
            // Handle both plain <t> and rich-text <r><t>
            let s = '';
            const rs = sis[i].getElementsByTagNameNS(SS_NS, 'r');
            if (rs.length) {
                for (const r of Array.from(rs)) {
                    const t = r.getElementsByTagNameNS(SS_NS, 't')[0];
                    if (t) s += t.textContent;
                }
            } else {
                const t = sis[i].getElementsByTagNameNS(SS_NS, 't')[0];
                if (t) s = t.textContent;
            }
            strings.push(s);
            if (!(s in ssIdx)) ssIdx[s] = i;
        }
    }

    function getOrAddSS(str) {
        if (str in ssIdx) return ssIdx[str];
        const idx = strings.length;
        strings.push(str);
        ssIdx[str] = idx;
        if (ssDoc) {
            const si = ssDoc.createElementNS(SS_NS, 'si');
            const t  = ssDoc.createElementNS(SS_NS, 't');
            if (str !== str.trim()) t.setAttribute('xml:space', 'preserve');
            t.textContent = str;
            si.appendChild(t);
            ssDoc.documentElement.appendChild(si);
        }
        return idx;
    }

    // ── Worksheet XML ─────────────────────────────────────────────────────────
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const sheetDoc = parser.parseFromString(sheetXml, 'text/xml');

    const rowEls = sheetDoc.getElementsByTagNameNS(SS_NS, 'row');
    for (const rowEl of Array.from(rowEls)) {
        const R = parseInt(rowEl.getAttribute('r')) - 1; // 0-based
        for (const cEl of Array.from(rowEl.getElementsByTagNameNS(SS_NS, 'c'))) {
            const ref = cEl.getAttribute('r');
            if (!ref) continue;
            const { r, c } = XLSX.utils.decode_cell(ref);
            const newText = changedCells.get(`${r},${c}`);
            if (newText === undefined) continue; // not changed

            const cellType = cEl.getAttribute('t') || '';
            const vEl = cEl.getElementsByTagNameNS(SS_NS, 'v')[0];

            if (cellType === 's') {
                // Shared string — update the index
                const newIdx = getOrAddSS(newText);
                if (vEl) vEl.textContent = String(newIdx);
            } else {
                // Number / formula / other: try to keep as number
                const num = Number(newText);
                if (newText !== '' && !isNaN(num)) {
                    cEl.removeAttribute('t');
                    if (vEl) vEl.textContent = newText;
                    else {
                        const v = sheetDoc.createElementNS(SS_NS, 'v');
                        v.textContent = newText;
                        cEl.appendChild(v);
                    }
                } else {
                    // Convert to shared string
                    cEl.setAttribute('t', 's');
                    const newIdx = getOrAddSS(newText);
                    if (vEl) vEl.textContent = String(newIdx);
                    else {
                        const v = sheetDoc.createElementNS(SS_NS, 'v');
                        v.textContent = String(newIdx);
                        cEl.appendChild(v);
                    }
                }
            }
        }
    }

    // ── Write back ────────────────────────────────────────────────────────────
    zip.file('xl/worksheets/sheet1.xml', ser.serializeToString(sheetDoc));
    if (ssDoc) {
        const root = ssDoc.documentElement;
        root.setAttribute('count',       String(strings.length));
        root.setAttribute('uniqueCount', String(strings.length));
        zip.file('xl/sharedStrings.xml', ser.serializeToString(ssDoc));
    }

    const newBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return uint8ArrayToBase64(newBytes);
}

// ─── SpreadsheetViewer — full-screen fixed overlay ───────────────────────────
// Rendered as a direct child (t-if) of ExcelEditorWidget, so t-ref works
// without any Dialog/slot wrapper (same pattern as CameraCapture widget).

class SpreadsheetViewer extends Component {
    static template = "excel_editor_widget.SpreadsheetViewer";
    static props = {
        base64Data: String,
        filename:   String,
        onSave:     Function,
        onClose:    Function,
    };

    setup() {
        this.state      = useState({ mode: 'loading', editing: false });
        this.contentRef = useRef('content');   // always in DOM (no t-if)
        this._wb        = null;
        this._bytes     = null;
        this._origCells = {};  // "R,C" → original display text
        this._imgColPos = null; // cached from _renderContent — reused in edit mode
        this._imgRowPos = null;
        this._saveTimer = null;
        this._saving    = false;

        this._boundVisibility   = () => { if (document.hidden) this._doSave(); };
        this._boundBeforeUnload = (ev) => {
            this._doSave(); // best-effort (async, may not finish before unload)
            if (this._hasPendingChanges()) {
                ev.preventDefault();
                ev.returnValue = '';
            }
        };

        onMounted(async () => {
            try {
                const bytes  = base64ToUint8Array(this.props.base64Data);
                this._bytes  = bytes;
                this._wb     = XLSX.read(bytes, { type: 'array' });
                this._buildOrigMap();
                await this._renderContent();           // build table + initial image pass
                this.state.mode    = 'ready';
                this.state.editing = true;
                await new Promise(r => requestAnimationFrame(r)); // OWL patches toolbar
                this._setEditable(true);               // contentEditable on cells, yellow bg
                await new Promise(r => requestAnimationFrame(r)); // layout settles after contentEditable
                await this._repositionImages();        // re-measure + re-place in settled layout

                // Auto-save: debounce on every cell keystroke
                this.contentRef.el.addEventListener('input', () => this._scheduleSave());
                // Auto-save: tab hidden or page navigated away
                document.addEventListener('visibilitychange', this._boundVisibility);
                window.addEventListener('beforeunload', this._boundBeforeUnload);
            } catch (e) {
                console.error('[ExcelViewer]', e);
                this.state.mode = 'error';
            }
        });

        onWillUnmount(() => {
            document.removeEventListener('visibilitychange', this._boundVisibility);
            window.removeEventListener('beforeunload', this._boundBeforeUnload);
            clearTimeout(this._saveTimer);
            this._wb = null;
        });
    }

    // Record original cell display values so we can detect what changed on save
    _buildOrigMap() {
        const ws = this._wb?.Sheets[this._wb.SheetNames[0]];
        if (!ws || !ws['!ref']) return;
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let r = range.s.r; r <= range.e.r; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
                const cell = ws[XLSX.utils.encode_cell({ r, c })];
                if (!cell) continue;
                const text = cell.w !== undefined
                    ? cell.w
                    : (cell.v !== undefined && cell.v !== null ? String(cell.v) : '');
                if (text) this._origCells[`${r},${c}`] = text;
            }
        }
    }

    // Render: HTML table + image overlays, injected directly into the DOM ref.
    // Two-pass layout: attach the table first so tr.offsetTop gives real px values,
    // then add image overlays using those DOM-measured positions. This avoids the
    // accumulated discrepancy that occurs when rowPos is used directly — border-collapse
    // + box-sizing:border-box over 300+ rows can shift images by 40–80px.
    async _renderContent() {
        const el = this.contentRef.el;
        if (!el || !this._wb) return;

        const ws = this._wb.Sheets[this._wb.SheetNames[0]];
        const zipRowHeights = await parseRowHeightsFromZip(this._bytes);
        const { colPos, rowPos } = buildPositions(ws, zipRowHeights);

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;display:inline-block;min-width:100%;';
        wrapper.innerHTML = buildHtmlTable(ws, colPos, rowPos);

        // Pass 1: put table in DOM so the browser lays it out.
        el.innerHTML = '';
        el.appendChild(wrapper);

        // Pass 2: read actual row and column positions from the live DOM.
        // offsetTop / getBoundingClientRect force layout synchronously right
        // after table insertion — this is the most reliable measurement window.
        // Cache these so edit mode can reuse identical positions (no re-measure drift).
        const domRowPos = buildDomRowPos(wrapper);
        const domColPos = buildDomColPos(wrapper);
        this._imgRowPos = domRowPos.length > 1 ? domRowPos : rowPos;
        this._imgColPos = domColPos.length > 1 ? domColPos : colPos;

        try {
            const imgs = await extractImages(this._bytes, this._imgColPos, this._imgRowPos);
            this._placeImages(wrapper, imgs, this._imgRowPos);
        } catch (e) {
            console.warn('[ExcelViewer] image extraction failed:', e);
        }
    }

    // Place image elements into wrapper.
    // Do NOT set CSS width/height on <img> — forcing anchor dimensions compresses
    // image content when the OOXML anchor extent doesn't match the image's natural
    // pixel size (right side appears cut off). Instead, let each image render at
    // its natural size and expand the wrapper once it loads.
    _placeImages(wrapper, imgs, imgRowPos) {
        const tableBottom = imgRowPos[imgRowPos.length - 1] ?? 0;

        for (const img of imgs) {
            const imgEl = document.createElement('img');
            imgEl.src = img.src;
            imgEl.style.cssText =
                `position:absolute;left:${img.left}px;top:${img.top}px;`
                + `max-width:none;pointer-events:none;z-index:10;`;

            // Once the image loads at its natural size, expand the wrapper so the
            // content area's overflow:auto provides scrollbars if needed.
            imgEl.addEventListener('load', () => {
                const right  = img.left + imgEl.naturalWidth;
                const bottom = img.top  + imgEl.naturalHeight;
                const curW = parseFloat(wrapper.style.minWidth)  || 0;
                const curH = parseFloat(wrapper.style.minHeight) || tableBottom;
                if (right  > curW) wrapper.style.minWidth  = `${right}px`;
                if (bottom > curH) wrapper.style.minHeight = `${bottom + 20}px`;
            }, { once: true });

            wrapper.appendChild(imgEl);
        }
    }

    // Re-measure DOM positions and re-place images.
    // Called after _setEditable(true) because contentEditable can subtly shift
    // how the browser renders table cells, invalidating positions measured earlier.
    async _repositionImages() {
        const el = this.contentRef.el;
        if (!el || !this._wb || !this._bytes) return;
        const wrapper = el.firstElementChild;
        if (!wrapper) return;

        wrapper.querySelectorAll('img').forEach(img => img.remove());

        const ws = this._wb.Sheets[this._wb.SheetNames[0]];
        const zipRowHeights = await parseRowHeightsFromZip(this._bytes);
        const { colPos, rowPos } = buildPositions(ws, zipRowHeights);
        const domRowPos = buildDomRowPos(wrapper);
        const domColPos = buildDomColPos(wrapper);
        const imgRowPos = domRowPos.length > 1 ? domRowPos : rowPos;
        const imgColPos = domColPos.length > 1 ? domColPos : colPos;
        this._imgRowPos = imgRowPos;
        this._imgColPos = imgColPos;

        try {
            const imgs = await extractImages(this._bytes, imgColPos, imgRowPos);
            this._placeImages(wrapper, imgs, imgRowPos);
        } catch (e) {
            console.warn('[ExcelViewer] reposition failed:', e);
        }
    }

    // Toggle all <td data-r> elements between contenteditable and read-only.
    _setEditable(on) {
        const el = this.contentRef.el;
        if (!el) return;
        el.querySelectorAll('td[data-r]').forEach(td => {
            td.contentEditable = on ? 'plaintext-only' : 'false';
            td.style.outline   = on ? '1px dashed #aaa' : '';
            td.style.cursor    = on ? 'text' : '';
        });
        const wrapper = el.firstElementChild;
        if (wrapper) wrapper.style.background = on ? '#fffde7' : '';
    }

    async startEditing() {
        this.state.editing = true;
        await new Promise(r => requestAnimationFrame(r));
        this._setEditable(true);
    }

    stopEditing() {
        this._setEditable(false);
        this.state.editing = false;
    }

    _hasPendingChanges() {
        const el = this.contentRef.el;
        if (!el) return false;
        for (const td of el.querySelectorAll('td[data-r]')) {
            const key = `${parseInt(td.dataset.r)},${parseInt(td.dataset.c)}`;
            if (td.textContent !== (this._origCells[key] || '')) return true;
        }
        return false;
    }

    _scheduleSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._doSave(), 1500);
    }

    async _doSave() {
        if (this._saving) return;
        const el = this.contentRef.el;
        if (!el || !this._bytes) return;

        const changed = new Map();
        el.querySelectorAll('td[data-r]').forEach(td => {
            const r = parseInt(td.dataset.r);
            const c = parseInt(td.dataset.c);
            const key  = `${r},${c}`;
            const newT = td.textContent;
            const oldT = this._origCells[key] || '';
            if (newT !== oldT) changed.set(key, newT);
        });

        if (!changed.size) return;

        this._saving = true;
        try {
            const newB64 = await saveWithImagesPreserved(this._bytes, changed);
            if (newB64) {
                this._bytes = base64ToUint8Array(newB64);
                this._wb    = XLSX.read(this._bytes, { type: 'array' });
                this._buildOrigMap();
                await this.props.onSave(newB64);
            }
        } catch (e) {
            console.error('[ExcelViewer] auto-save error:', e);
        } finally {
            this._saving = false;
        }
    }

    async save() {
        if (!this.contentRef.el) { this.props.onClose(); return; }
        clearTimeout(this._saveTimer);
        try {
            await this._doSave();
        } catch (e) {
            console.error('[ExcelViewer] save error:', e);
            alert('Save failed: ' + e.message);
            return;
        }
        this.stopEditing();
        this.props.onClose();
    }

    async close() {
        await this.save();
    }
}

// ─── ExcelEditorWidget (main field widget) ────────────────────────────────────

class ExcelEditorWidget extends Component {
    static template   = "excel_editor_widget.ExcelEditorWidget";
    static components = { SpreadsheetViewer };
    static props      = { ...standardFieldProps };

    setup() {
        this.state = useState({
            hasData:    false,
            filename:   null,
            viewerOpen: false,
            viewerB64:  null,
        });
        this.uploadRef = useRef('uploadInput');

        onMounted(() => this._syncState(this.props));
        onWillUnmount(() => {});
        onWillUpdateProps(nextProps => this._syncState(nextProps));
    }

    _syncState(props) {
        const val = props.record.data[props.name];
        this.state.hasData = !!val;
        const fnField = `${props.name}_filename`;
        this.state.filename = props.record.data[fnField] || (val ? 'spreadsheet.xlsx' : null);
    }

    get isReadonly() { return this.props.readonly; }

    triggerUpload() { this.uploadRef.el.click(); }

    async onUpload(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        ev.target.value = '';
        const b64 = uint8ArrayToBase64(new Uint8Array(await file.arrayBuffer()));
        const updates  = { [this.props.name]: b64 };
        const fnField  = `${this.props.name}_filename`;
        if (this.props.record.fields[fnField]) updates[fnField] = file.name;
        await this.props.record.update(updates);
        this.state.filename = file.name;
        this.state.hasData  = true;
    }

    async _fetchBase64() {
        let b64 = this.props.record.data[this.props.name];
        if (isBinarySize(b64) && this.props.record.resId) {
            const res = await this.props.record.model.orm.read(
                this.props.record.resModel, [this.props.record.resId], [this.props.name]
            );
            b64 = res?.[0]?.[this.props.name] || null;
        }
        return b64;
    }

    async openViewer() {
        const b64 = await this._fetchBase64();
        if (!b64) return;
        this.state.viewerB64  = b64;
        this.state.viewerOpen = true;
    }

    async onSave(newB64) {
        await this.props.record.update({ [this.props.name]: newB64 });
        try { await this.props.record.save(); } catch {}
        this.state.hasData = true;
    }

    closeViewer() {
        this.state.viewerOpen = false;
        this.state.viewerB64  = null;
    }

    async download() {
        const b64 = await this._fetchBase64();
        if (!b64) return;
        const blob = new Blob([base64ToUint8Array(b64)], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), {
            href: url, download: this.state.filename || 'spreadsheet.xlsx',
        }).click();
        URL.revokeObjectURL(url);
    }

    async clearFile() {
        const updates = { [this.props.name]: false };
        const fnField = `${this.props.name}_filename`;
        if (this.props.record.fields[fnField]) updates[fnField] = false;
        await this.props.record.update(updates);
        this.state.hasData  = false;
        this.state.filename = null;
    }

}

registry.category("fields").add("excel_editor", {
    component:      ExcelEditorWidget,
    displayName:    "Excel Editor",
    supportedTypes: ["binary"],
});
