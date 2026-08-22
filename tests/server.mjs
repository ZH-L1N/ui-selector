// tests/server.mjs — usage: node tests/server.mjs <dir> <port> [host]
import { createServer } from 'node:http'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'

const [dir, port, host = 'localhost'] = process.argv.slice(2)
const ROOT = resolve(dir)
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                '.json': 'application/json', '.svg': 'image/svg+xml',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

createServer(async (req, res) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname)
  } catch {
    res.writeHead(400).end('bad path')          // malformed percent-encoding
    return
  }
  try {
    const target = resolve(join(ROOT, normalize(pathname)))
    const s = await stat(target)
    const file = s.isDirectory() ? join(target, 'index.html') : target
    // realpath + relative, not startsWith: a lexical prefix check does not stop a
    // symlink pointing outside the fixture root.
    const real = await realpath(file)
    const rel = relative(await realpath(ROOT), real)
    if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403).end('forbidden'); return }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',            // lets :8082 serve CSS to :8081
    })
    res.end(await readFile(real))
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(Number(port), host)
