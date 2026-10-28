/**
 * The editor's look, injected once: the bundle is one module, with no stylesheet to link.
 *
 * The panel takes a side of the screen and the game the rest (`fit` in main.tsx). The body has a
 * transform, so what the game pins with `position: fixed` — its canvas, its HUD — is pinned to the
 * body, not the window, and stays clear of the panel.
 */
export const STYLE = `
:root { --se-w: min(380px, 42vw); --se-h: 52dvh; }
body.scenoco-editing { position: fixed !important; margin: 0 !important; overflow: hidden !important; }
/* What shows beside the game when it keeps its shape: the editor's, not the page's own background. */
html:has(> body.scenoco-editing) { background: #020617 !important; }
/* Only the game's canvas — three.js marks its own — for editing the 3D without the HUD in the way. */
body.scenoco-canvas-only * { visibility: hidden !important; }
body.scenoco-canvas-only canvas[data-engine^="three"] { visibility: visible !important; }

#scenoco-editor { position: fixed; z-index: 2147483000; top: 0; right: 0; bottom: 0; width: var(--se-w); font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; color: #e2e8f0; -webkit-text-size-adjust: 100%; }
@media (orientation: portrait) {
  #scenoco-editor { top: auto; left: 0; width: auto; height: var(--se-h); }
}
#scenoco-editor * { box-sizing: border-box; }
.se-mount { height: 100%; }
.se-grip { position: absolute; z-index: 1; top: 0; bottom: 0; left: -4px; width: 9px; cursor: ew-resize; touch-action: none; }
.se-grip::after { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: transparent; transition: background 0.15s; }
.se-grip:hover::after, .se-grip:active::after { background: #38bdf8; width: 2px; }
@media (orientation: portrait) {
  .se-grip { top: -6px; bottom: auto; left: 0; right: 0; width: auto; height: 13px; cursor: ns-resize; }
  .se-grip::after { top: 6px; bottom: auto; left: 0; right: 0; width: auto; height: 1px; }
  .se-grip:hover::after, .se-grip:active::after { width: auto; height: 2px; }
}
#scenoco-editor svg { width: 18px; height: 18px; }

.se-panel { height: 100%; display: flex; flex-direction: column; background: #0f172a; border-left: 1px solid #1e293b; padding-bottom: env(safe-area-inset-bottom); }
@media (orientation: portrait) { .se-panel { border-left: 0; border-top: 1px solid #1e293b; } }

.se-bar { display: flex; align-items: center; gap: 2px; padding: 4px; border-bottom: 1px solid #1e293b; }
.se-gap { width: 10px; }
.se-fill { flex: 1; }
.se-button { position: relative; display: grid; place-items: center; min-width: 36px; height: 36px; border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; touch-action: manipulation; }
.se-button:hover:not(:disabled) { background: #1e293b; }
.se-button:disabled { opacity: 0.35; cursor: default; }
.se-pressed, .se-pressed:hover:not(:disabled) { background: #075985; }
.se-badge { position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 0 2px #0f172a; }
.se-panel { position: relative; }
.se-backdrop { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; padding: 16px; background: #02061799; }
.se-popup { width: min(360px, 100%); max-height: calc(100dvh - 32px); overflow: auto; padding: 6px 16px 14px; border: 1px solid #334155; border-radius: 10px; background: #111c33; box-shadow: 0 16px 48px #000a; }
.se-popupHead { display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 14px; }
.se-popup section { padding-top: 8px; }
.se-popup h3 { margin: 6px 0 2px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; }
.se-popup p { margin: 0 0 4px; color: #94a3b8; font-size: 12px; }
.se-choice { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; cursor: pointer; }
.se-choice input { margin-top: 3px; accent-color: #38bdf8; }
.se-choice small { display: block; color: #94a3b8; font-size: 11.5px; overflow-wrap: anywhere; }
.se-choice code { font: 11.5px ui-monospace, monospace; color: #e2e8f0; }
.se-status { padding: 4px 10px; font-size: 12px; color: #94a3b8; border-bottom: 1px solid #1e293b; overflow-wrap: anywhere; }
.se-error { color: #fecaca; background: #450a0a; }

.se-tree { flex: 0 0 38%; overflow: auto; padding: 4px 0; border-bottom: 1px solid #1e293b; }
.se-row { display: flex; align-items: center; gap: 2px; min-height: 28px; padding-right: 8px; white-space: nowrap; cursor: pointer; }
.se-row:hover { background: #1e293b; }
.se-selected, .se-selected:hover { background: #075985; }
.se-dim { opacity: 0.55; font-style: italic; }
.se-caret { display: grid; place-items: center; width: 22px; height: 28px; flex: none; color: #64748b; }
.se-caret svg { width: 14px; height: 14px; }
.se-made { color: #7dd3fc; font-family: ui-monospace, monospace; }
.se-chips { margin-left: 8px; color: #a78bfa; font-size: 11px; overflow: hidden; text-overflow: ellipsis; }

.se-code { flex: 1; overflow: auto; padding: 6px 10px 16px; font: 12.5px/1.75 ui-monospace, SFMono-Regular, Menlo, monospace; }
.se-empty { color: #64748b; font-family: inherit; }
.se-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.se-note { margin: 2px 0 6px; padding: 4px 8px; border-radius: 4px; background: #1e293b; color: #94a3b8; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
.se-line { white-space: nowrap; }
.se-tag { color: #7dd3fc; }
.se-name { color: #c4b5fd; }
.se-string, .se-string input { color: #fcd34d; }
.se-text { color: #94a3b8; }
.se-muted { color: #64748b; }
.se-where { margin-left: 10px; font-size: 11px; }
.se-link { color: #94a3b8; text-decoration: none; }
.se-link:hover { color: #e2e8f0; text-decoration: underline; }
.se-ref { color: inherit; text-decoration: underline dotted #64748b; text-underline-offset: 2px; }
.se-ref:hover { color: #7dd3fc; text-decoration-color: #7dd3fc; }
.se-unwritten .se-name, .se-unwritten .se-token { opacity: 0.55; }
.se-unsaved .se-name { color: #fbbf24; }
.se-unsaved .se-name::after { content: '*'; color: #fbbf24; }

.se-token { field-sizing: content; font: inherit; color: #86efac; background: none; border: 0; border-bottom: 1px dashed #334155; padding: 0 1px; margin: 0; min-width: 1ch; touch-action: pan-y; cursor: ew-resize; }
.se-token:focus { outline: none; background: #1e293b; border-bottom-color: #38bdf8; cursor: text; }
.se-bool { cursor: pointer; color: #fda4af; }
.se-option { cursor: pointer; color: #86efac; appearance: none; -webkit-appearance: none; }
.se-string .se-option { color: #fcd34d; }
.se-option option { color: #e2e8f0; background: #0f172a; }
.se-swatch { width: 1.6em; height: 1.1em; padding: 0; margin: 0 4px -2px 0; border: 1px solid #334155; border-radius: 3px; background: none; vertical-align: baseline; }

.se-layer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0 2px; padding-top: 6px; border-top: 1px dashed #334155; color: #94a3b8; font: 11.5px/1.4 ui-sans-serif, system-ui, sans-serif; }
.se-layer:first-of-type { border-top: 0; margin-top: 2px; padding-top: 0; }
.se-layer b { color: #e2e8f0; font-weight: 600; }
.se-prefab { opacity: 0.8; }
.se-enter { flex: none; padding: 3px 9px; border: 1px solid #0369a1; border-radius: 5px; background: #0c4a6e; color: #e0f2fe; font: 600 11.5px system-ui, sans-serif; cursor: pointer; }
.se-note .se-enter { margin-left: 8px; }
.se-stage { display: flex; align-items: center; gap: 6px; padding: 4px 6px; background: #0c4a6e; border-bottom: 1px solid #0369a1; }
.se-crumbs { flex: 1; min-width: 0; }
.se-crumbs b { font-family: ui-monospace, monospace; color: #e0f2fe; }
.se-crumbs small { display: block; color: #bae6fd; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.se-outside { opacity: 0.35; }
.se-tip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 2px 0 4px; padding: 4px 8px; border-radius: 4px; background: #1e293b; color: #94a3b8; font: 12px/1.4 ui-sans-serif, system-ui, sans-serif; white-space: normal; }
.se-tip code { color: #e2e8f0; font: 12px ui-monospace, monospace; }
.se-revert { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-left: 6px; padding: 0; border: 0; border-radius: 4px; background: none; color: #fbbf24; vertical-align: -5px; cursor: pointer; touch-action: manipulation; }
.se-revert:hover { background: #1e293b; }
#scenoco-editor .se-revert svg { width: 14px; height: 14px; }
.se-scenes { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-bottom: 1px solid #1e293b; color: #94a3b8; font-size: 12px; }
.se-scenes select { flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid #334155; border-radius: 5px; background: #111c33; color: #e2e8f0; font: 13px system-ui, sans-serif; }
`;
