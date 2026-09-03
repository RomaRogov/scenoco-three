/**
 * The websocket path, substituted into the page at serve time by the observer's Vite config.
 * A constant rather than an import because `src/` is not published — see the observer's
 * `app/globals.d.ts`, which this page shares the arrangement with.
 */
declare const __SCENOCO_WS_PATH__: string;
