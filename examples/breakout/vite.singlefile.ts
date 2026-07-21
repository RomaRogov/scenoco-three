import type { Plugin } from 'vite';

/**
 * Inlines every locally-bundled resource (JS, CSS, and any asset Vite would
 * normally emit as a file) into a single self-contained index.html that runs
 * even when opened directly over `file://`.
 *
 * Why IIFE + a classic <script>: browsers refuse to execute
 * `<script type="module">` loaded over `file://` (it's blocked by CORS), so a
 * single-file demo that uses a module script is blank when double-clicked. We
 * build the app as a self-executing IIFE (no import/export) and inline it as a
 * classic script, which runs from both `file://` and http.
 */
export function singleFile(): Plugin {
  // Inline (data-URI) sourcemap, not a separate `.map` file: the whole point of
  // this build is running from `file://`, where a sibling `.map` is unreachable
  // — but a `//# sourceMappingURL=data:...` comment travels inside the inlined
  // <script>, so a minified crash still maps back to real source. It's appended
  // to the entry chunk's code below.
  //
  // Off by default: the sourcemap embeds every source's full text (including
  // three.js's own shader-chunk strings), which dwarfs the actual app — on
  // Breakout it's ~5 MB of a ~6 MB file, the overwhelming majority of the
  // download. Opt in with `SCENOCO_SOURCEMAP=1 npm run build` when you actually
  // need to map a minified stack trace back to source; leave it off for a build
  // you're sharing/deploying, where a small file matters more than that.
  const sourcemap = process.env.SCENOCO_SOURCEMAP === '1' ? 'inline' : false;
  return {
    name: 'scenoco:singlefile',
    apply: 'build',
    enforce: 'post',

    // Build settings that make a single self-contained file possible.
    config() {
      return {
        base: './', // keep any stray relative ref working from file://
        build: {
          assetsInlineLimit: Number.MAX_SAFE_INTEGER, // inline local assets as data URIs
          cssCodeSplit: false,
          modulePreload: { polyfill: false },
          sourcemap,
          // One self-executing IIFE chunk → runs as a classic script over file://.
          rollupOptions: { output: { format: 'iife', codeSplitting: false } as never },
        },
      };
    },

    generateBundle(_options, bundle) {
      const htmlName = Object.keys(bundle).find((f) => f.endsWith('.html'));
      const html = htmlName ? bundle[htmlName] : undefined;
      if (!html || html.type !== 'asset') return;

      let source = String(html.source);

      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'chunk' && item.isEntry) {
          // `</script>` inside bundled string literals would close our inline
          // tag early; neutralize it (valid JS, identical at runtime).
          const code = item.code.replace(/<\/script/gi, '<\\/script');
          // Use callback replacement so `$&`, `$'`, etc. inside bundled code
          // are not treated as String.replace placeholders.
          source = source.replace(scriptTagFor(fileName), () => `<script>\n${code}\n</script>`);
          delete bundle[fileName];
        } else if (item.type === 'asset' && fileName.endsWith('.css')) {
          const style = `<style>\n${String(item.source)}\n</style>`;
          const link = linkTagFor(fileName);
          source = link.test(source)
            ? source.replace(link, () => style)
            : source.replace('</head>', `${style}\n</head>`);
          delete bundle[fileName];
        }
      }

      // Drop preload hints that now point at code we've inlined.
      source = source.replace(/\s*<link[^>]*rel="modulepreload"[^>]*>/g, '');
      html.source = source;
    },
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches the emitted <script ... src="…<fileName>"></script> regardless of
// base prefix, crossorigin, or attribute order.
const scriptTagFor = (fileName: string) =>
  new RegExp(`<script[^>]*\\bsrc="[^"]*${escapeRegExp(fileName)}"[^>]*>\\s*</script>`);

const linkTagFor = (fileName: string) =>
  new RegExp(`<link[^>]*\\bhref="[^"]*${escapeRegExp(fileName)}"[^>]*>`);
