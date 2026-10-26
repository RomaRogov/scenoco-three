/**
 * Development only: what a phone sees, sent to the dev server's terminal (`[phone]` lines). The
 * device and its GPU, how far loading got, every error and warning, and a lost WebGL context —
 * enough to tell a driver crash from a bug without a cable to the phone.
 */
export function log(kind: string, data: unknown = '') {
  if (!import.meta.env.DEV) return;
  const body = JSON.stringify({ t: Math.round(performance.now()), kind, data });
  try {
    if (!navigator.sendBeacon?.('/__log', body)) void fetch('/__log', { method: 'POST', body, keepalive: true });
  } catch {
    // Nothing to report to: the page goes on.
  }
}

function gpu() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { webgl2: false };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const result = {
    webgl2: true,
    vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    fragmentUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    vertexUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return result;
}

if (import.meta.env.DEV) {
  log('device', { ua: navigator.userAgent, dpr: devicePixelRatio, size: [innerWidth, innerHeight], memory: (navigator as { deviceMemory?: number }).deviceMemory, gpu: gpu(), webgpu: 'gpu' in navigator });
  addEventListener('error', (e) => log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => log('rejection', String((e as PromiseRejectionEvent).reason?.stack ?? (e as PromiseRejectionEvent).reason)));
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(level, args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)?.slice(0, 400))).join(' '));
      original(...args);
    };
  }
  document.addEventListener('webglcontextlost', () => log('CONTEXT LOST'), true);
  document.addEventListener('webglcontextrestored', () => log('context restored'), true);
  document.addEventListener('visibilitychange', () => log('visibility', document.visibilityState));
}
