/**
 * The editor's look, carried in the bundle: the game's page loads one script, so there is no
 * stylesheet to link. The game's own page elements — its HUD — are hidden while editing.
 */
export const STYLE = `
body.scenoco-editing > *:not(canvas):not(#scenoco-editor):not(script):not(style) { display: none !important; }
body.scenoco-editing > canvas { position: fixed; inset: 0; touch-action: none; }

#scenoco-editor {
  /* Translucent: a panel floats over the scene, and the scene behind it is context. */
  --panel: rgba(20, 24, 32, 0.92);
  --line: #2a3344;
  --edge: #3d4b64;
  --accent: #4af0e0;
  position: fixed; inset: 0; z-index: 1000; pointer-events: none;
  color-scheme: dark; color: #d6e2f0;
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-tap-highlight-color: transparent;
}
#scenoco-editor * { box-sizing: border-box; }
#scenoco-editor button { font: inherit; }

/* ── top bar ── */
#scenoco-editor .se-topbar {
  position: fixed; z-index: 3; top: calc(8px + env(safe-area-inset-top, 0px)); left: 8px; right: 8px; margin: 0 auto;
  width: max-content; max-width: calc(100% - 16px);
  display: flex; align-items: center; gap: 2px; padding: 5px; border-radius: 12px;
  background: var(--panel); border: 1px solid var(--edge); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px); pointer-events: auto;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch;
}
#scenoco-editor .se-topbar::-webkit-scrollbar { display: none; }
#scenoco-editor .se-tbtn {
  flex: 0 0 auto; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
  padding: 0; border: 1px solid transparent; border-radius: 9px; background: transparent; color: #cfe0f2; cursor: pointer;
}
#scenoco-editor .se-tbtn svg { width: 21px; height: 21px; }
#scenoco-editor .se-tbtn:hover:not(:disabled) { background: rgba(74, 240, 224, 0.12); color: #eafdff; }
#scenoco-editor .se-tbtn.se-active { background: rgba(74, 240, 224, 0.2); border-color: var(--accent); color: #eafdff; }
#scenoco-editor .se-tbtn:disabled { opacity: 0.3; cursor: default; }
#scenoco-editor .se-sep { flex: 0 0 auto; width: 1px; height: 24px; background: var(--line); margin: 0 3px; }

#scenoco-editor .se-status {
  position: fixed; z-index: 3; top: calc(62px + env(safe-area-inset-top, 0px)); left: 8px; right: 8px; margin: 0 auto;
  width: max-content; max-width: calc(100% - 16px); padding: 6px 12px; border-radius: 9px;
  background: var(--panel); border: 1px solid var(--edge); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  pointer-events: none; font-size: 12px; line-height: 1.4; color: #cfe0f5; white-space: pre-wrap; text-align: center;
}
#scenoco-editor .se-status.se-error { color: #ffb4b4; border-color: #7f1d1d; }

/* ── launchers ── */
#scenoco-editor .se-launcher {
  position: fixed; z-index: 1; bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
  padding: 0; border-radius: 14px; cursor: pointer; pointer-events: auto;
  background: var(--panel); border: 1px solid var(--edge); color: #cfe0f2;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45); backdrop-filter: blur(6px);
}
#scenoco-editor .se-launcherLeft { left: 12px; }
#scenoco-editor .se-launcherRight { right: 12px; }
#scenoco-editor .se-launcher:hover { color: #eafdff; border-color: var(--accent); }
#scenoco-editor .se-launcher svg { width: 24px; height: 24px; }

/* ── sheets: bottom-docked upright, one at a time; side columns sideways ── */
#scenoco-editor .se-sheet {
  position: fixed; z-index: 2; display: flex; flex-direction: column;
  left: 0; right: 0; bottom: 0; height: min(50vh, 460px); border-radius: 16px 16px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--panel); border: 1px solid var(--edge); backdrop-filter: blur(10px);
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.55); pointer-events: auto;
  animation: se-in 0.18s ease;
}
@keyframes se-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (orientation: landscape) {
  /* Below the toolbar, which sits over the gap between the columns on a wide screen but not on a phone. */
  #scenoco-editor .se-sheet { top: 64px; bottom: 12px; height: auto; border-radius: 16px; width: min(380px, 42vw); padding-bottom: 0; }
  #scenoco-editor .se-sheetLeft { left: 12px; right: auto; }
  #scenoco-editor .se-sheetRight { right: 12px; left: auto; }
}
#scenoco-editor .se-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 14px; border-bottom: 1px solid var(--line); }
#scenoco-editor .se-title {
  flex: 0 1 auto; min-width: 0; font: 700 11px/1 ui-monospace, monospace; color: #9fe7ff;
  letter-spacing: 0.08em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#scenoco-editor .se-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; min-width: 0; overflow-x: auto; scrollbar-width: none; }
#scenoco-editor .se-headBtn {
  flex: 0 0 auto; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
  padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #cfe0f2; cursor: pointer;
}
#scenoco-editor .se-headBtn svg { width: 18px; height: 18px; }
#scenoco-editor .se-headBtn:hover:not(:disabled) { background: rgba(74, 240, 224, 0.12); color: #eafdff; }
#scenoco-editor .se-headBtn:disabled { opacity: 0.32; cursor: default; }
#scenoco-editor .se-body { container-type: inline-size; flex: 1 1 auto; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }

/* ── tree ── */
#scenoco-editor .se-tree { height: 100%; padding: 4px 4px 0; overflow: hidden; }
#scenoco-editor .se-node {
  display: flex; align-items: center; gap: 4px; height: 100%; padding-right: 8px; cursor: pointer; white-space: nowrap;
  font: 12px/1.4 ui-monospace, monospace; color: #d6e2f0; border-radius: 6px;
}
#scenoco-editor .se-node:hover { background: rgba(74, 240, 224, 0.08); }
#scenoco-editor .se-node.se-sel { background: rgba(74, 240, 224, 0.18); color: #eafdff; }
#scenoco-editor .se-node.se-made { color: #6f8099; }
#scenoco-editor .se-caret { flex: 0 0 24px; height: 100%; display: flex; align-items: center; justify-content: center; color: #6f93b8; }
#scenoco-editor .se-caret svg { width: 14px; height: 14px; }
#scenoco-editor .se-nodeName { overflow: hidden; text-overflow: ellipsis; }
#scenoco-editor .se-nodeType { color: #6f93b8; margin-left: 6px; }

/* ── inspector ── */
#scenoco-editor .se-inspector { padding: 6px 12px 16px; font: 12px/1.5 ui-monospace, monospace; }
#scenoco-editor .se-identity { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; padding: 6px 0 4px; }
#scenoco-editor .se-identityName { font-weight: 700; color: #eafdff; }
#scenoco-editor .se-source { color: #6f8099; }
#scenoco-editor .se-hint, #scenoco-editor .se-empty { color: #6f8099; padding: 4px 0; }
#scenoco-editor .se-empty { padding: 16px 4px; }
#scenoco-editor .se-section { margin-top: 4px; }
#scenoco-editor .se-secHead {
  display: flex; align-items: center; gap: 4px; margin: 10px 0 4px; padding-bottom: 3px;
  color: #9fe7ff; font-weight: 700; border-bottom: 1px solid var(--line); cursor: pointer; user-select: none;
  text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px;
}
#scenoco-editor .se-secCaret { flex: 0 0 14px; display: inline-flex; color: #6f93b8; }
#scenoco-editor .se-secCaret svg { width: 13px; height: 13px; }

/* A name and its widget; a vector's axes share the widget's column equally. */
#scenoco-editor .se-row { display: grid; grid-template-columns: minmax(64px, 30%) minmax(0, 1fr); align-items: center; gap: 8px; min-height: 36px; padding: 2px 0; }
#scenoco-editor .se-k { color: #8fa6c4; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#scenoco-editor .se-v { color: #e7f0fb; display: flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0; }
#scenoco-editor .se-unset .se-k { color: #61708a; }
#scenoco-editor .se-unset .se-input, #scenoco-editor .se-unset .se-swatch, #scenoco-editor .se-unset .se-toggle { opacity: 0.45; }
#scenoco-editor .se-unset:focus-within .se-input, #scenoco-editor .se-unset:focus-within .se-swatch { opacity: 1; }
#scenoco-editor .se-locked { cursor: help; }
#scenoco-editor .se-locked .se-k { color: #6f8099; }
#scenoco-editor .se-lockVal { color: #fbbf24; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
#scenoco-editor .se-lockIcon { width: 12px; height: 12px; color: #6f8099; flex: 0 0 auto; }
#scenoco-editor .se-clear {
  flex: 0 0 auto; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; border-radius: 6px; background: transparent; color: #6f8099; cursor: pointer;
}
#scenoco-editor .se-clearSlot { flex: 0 0 26px; }
#scenoco-editor .se-clear:hover { background: rgba(255, 120, 120, 0.14); color: #ff9b9b; }
#scenoco-editor .se-clear svg { width: 13px; height: 13px; }

/* 16px: smaller, and iOS zooms the page on every tap. */
#scenoco-editor .se-input {
  background: #0e1219; color: #e7f0fb; border: 1px solid var(--line); border-radius: 5px;
  padding: 3px 6px; font: 16px ui-monospace, monospace; min-height: 30px; min-width: 0;
}
#scenoco-editor .se-input:focus { outline: none; border-color: var(--accent); }
#scenoco-editor .se-num { width: 88px; text-align: right; }
#scenoco-editor .se-text { flex: 1 1 auto; width: 100%; }
#scenoco-editor .se-axes { flex: 1 1 auto; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px; }
/* A narrow column — a phone on its side — puts a vector's name above its axes, so a number fits. */
@container (max-width: 360px) {
  #scenoco-editor .se-wide { grid-template-columns: minmax(0, 1fr); gap: 0; }
}
#scenoco-editor .se-axis { display: flex; align-items: center; min-width: 0; }
#scenoco-editor .se-axis .se-num { flex: 1 1 auto; width: 100%; padding-left: 3px; }
/* The letter is the drag handle: wide enough for a finger. */
#scenoco-editor .se-axisK { flex: 0 0 18px; color: #6f93b8; font-size: 11px; width: 18px; height: 30px; display: flex; align-items: center; justify-content: center; }
#scenoco-editor .se-scrub { cursor: ew-resize; touch-action: none; user-select: none; }
#scenoco-editor .se-toggle { width: 24px; height: 24px; accent-color: var(--accent); }
#scenoco-editor .se-color { display: flex; align-items: center; gap: 5px; }
#scenoco-editor .se-swatch { width: 34px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 5px; background: none; cursor: pointer; }
#scenoco-editor .se-hex { width: 96px; }
#scenoco-editor .se-color { flex: 0 1 auto; }
`;
