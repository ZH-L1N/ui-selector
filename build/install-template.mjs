// build/install-template.mjs — install page markup generator.
// The generated page must not inline any script: it is pure static markup, so it
// can be opened (or even hosted) anywhere without tripping a CSP.

const escapeHtml = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export function installPage({ url, trustedOrigins, bytes, builtAt }) {
  const origins = trustedOrigins
    .map((o) => `        <li><code>${escapeHtml(o)}</code></li>`)
    .join('\n')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ui-selector — install</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
      a.bookmarklet { display: inline-block; padding: 0.5rem 1rem; border: 2px solid #0a7; border-radius: 6px; color: #0a7; font-weight: 600; text-decoration: none; }
      code { background: #f2f2f2; padding: 0.1rem 0.3rem; border-radius: 3px; }
      ul { padding-left: 1.5rem; }
    </style>
  </head>
  <body>
    <h1>ui-selector</h1>
    <p>Drag this link to your bookmarks bar:</p>
    <p><a class="bookmarklet" href="${escapeHtml(url)}">ui-selector</a></p>
    <p>
      Encoded payload: <strong>${Number(bytes)} bytes</strong>, built
      <time datetime="${escapeHtml(builtAt)}">${escapeHtml(builtAt)}</time>.
    </p>
    <p>
      Trusted origins baked into <em>this</em> build. If the bookmark on your bar is
      older than the timestamp above, its list is whatever it was built with — rebuild
      and re-drag to be sure:
    </p>
    <ul>
${origins}
    </ul>
    <p>Rebuilding changes the payload — re-drag the link after every build.</p>
  </body>
</html>
`
}
