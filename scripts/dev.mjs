import { spawn, execSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const electronPath = require('electron')

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 5174
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}/`

/** @type {import('node:child_process').ChildProcess[]} */
const children = []
/** @type {Set<number>} */
const trackedPids = new Set()
let shuttingDown = false

function trackPid(pid) {
  if (pid && Number.isFinite(pid) && pid > 0) trackedPids.add(pid)
}

function killTree(pid) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return
  try {
    if (process.platform === 'win32') {
      // /T kills the whole process tree (cmd → npx → node → vite, etc.)
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        process.kill(pid, 'SIGTERM')
      }
    }
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* gone */
    }
  }
}

function pidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
      const pids = new Set()
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue
        const m = line.trim().match(/(\d+)\s*$/)
        if (m) pids.add(Number(m[1]))
      }
      return [...pids]
    }
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
    return out
      .split(/\s+/)
      .map((s) => Number(s))
      .filter(Boolean)
  } catch {
    return []
  }
}

function freeDevPort() {
  const pids = pidsOnPort(DEV_PORT).filter((pid) => pid !== process.pid)
  for (const pid of pids) {
    console.log(`[dev] freeing port ${DEV_PORT} (pid ${pid})`)
    killTree(pid)
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    trackPid(child.pid)
    try {
      // Prefer graceful signal first; Windows still needs taskkill for trees.
      if (process.platform !== 'win32' && child.pid) {
        child.kill('SIGTERM')
      }
    } catch {
      /* ignore */
    }
  }

  for (const pid of trackedPids) killTree(pid)
  freeDevPort()

  // Give taskkill a beat, then exit hard.
  setTimeout(() => process.exit(code), process.platform === 'win32' ? 150 : 0).unref?.()
  if (process.platform !== 'win32') process.exit(code)
}

function waitForPortFree(port, timeoutMs = 5000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ host: DEV_HOST, port }, () => {
        sock.destroy()
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Port ${port} still occupied`))
          return
        }
        setTimeout(tryOnce, 200)
      })
      sock.on('error', () => resolve(undefined))
    }
    tryOnce()
  })
}

async function buildElectron() {
  const { default: esbuild } = await import('esbuild')
  await esbuild.build({
    entryPoints: {
      main: path.join(root, 'electron/main.ts'),
      preload: path.join(root, 'electron/preload.ts'),
    },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outdir: path.join(root, 'dist-electron'),
    external: ['electron'],
    sourcemap: true,
    banner: {
      js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
    },
  })
  const promptMdSrc = path.join(root, 'shared', 'plugin-dev-prompt.md')
  const promptMdDst = path.join(root, 'dist-electron', 'plugin-dev-prompt.md')
  if (fs.existsSync(promptMdSrc)) {
    fs.copyFileSync(promptMdSrc, promptMdDst)
  }
}

function waitForUrl(url, timeoutMs = 60_000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve(undefined)
      })
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Dev server not ready: ${url}`))
          return
        }
        setTimeout(tryOnce, 300)
      })
    }
    tryOnce()
  })
}

function resolveViteEntrypoint() {
  const candidates = [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(root, 'node_modules', 'vite', 'dist', 'node', 'cli.js'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  throw new Error('vite CLI not found — run npm install')
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('SIGHUP', () => shutdown(0))
process.on('uncaughtException', (err) => {
  console.error('[dev] uncaughtException', err)
  shutdown(1)
})
// Windows: Ctrl+Break / console close
if (process.platform === 'win32') {
  try {
    // @ts-expect-error Node Windows-only
    process.on('SIGBREAK', () => shutdown(0))
  } catch {
    /* ignore */
  }
}
process.on('exit', () => {
  // Last-chance sync kill (no async here).
  for (const pid of trackedPids) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
      } else {
        process.kill(pid, 'SIGKILL')
      }
    } catch {
      /* gone */
    }
  }
})

freeDevPort()
await waitForPortFree(DEV_PORT)
await buildElectron()

{
  const assetsSrc = path.join(root, 'electron', 'assets')
  const assetsDst = path.join(root, 'dist-electron', 'assets')
  if (fs.existsSync(assetsSrc)) {
    fs.mkdirSync(assetsDst, { recursive: true })
    for (const name of fs.readdirSync(assetsSrc)) {
      fs.copyFileSync(path.join(assetsSrc, name), path.join(assetsDst, name))
    }
  }
}

// Spawn Vite with this Node binary — no cmd/npx shell (orphans on Windows otherwise).
const viteEntry = resolveViteEntrypoint()
const vite = spawn(
  process.execPath,
  [viteEntry, '--host', DEV_HOST, '--port', String(DEV_PORT), '--strictPort'],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  },
)
children.push(vite)
trackPid(vite.pid)
vite.on('spawn', () => trackPid(vite.pid))

vite.on('exit', (code, signal) => {
  if (shuttingDown) return
  if (code && code !== 0) {
    console.error('Vite exited early', code, signal || '')
    shutdown(code)
  }
})

console.log(`Waiting for ${DEV_URL} ...`)
await waitForUrl(DEV_URL)
console.log('Vite ready, launching Electron')

/** @type {import('node:child_process').ChildProcess | null} */
let electronChild = null
/** Generation counter: ignore exit from Electron processes we intentionally killed for reload. */
let electronGeneration = 0

function startElectron() {
  const generation = ++electronGeneration
  const child = spawn(String(electronPath), ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: DEV_URL,
    },
    windowsHide: false,
  })
  electronChild = child
  children.push(child)
  trackPid(child.pid)
  child.on('spawn', () => trackPid(child.pid))
  child.on('exit', (code) => {
    if (shuttingDown) return
    // Stale exit from a process we killed to hot-restart — do not tear down Vite.
    if (generation !== electronGeneration || child !== electronChild) return
    console.log(`[dev] Electron exited (${code ?? 0}); stopping dev server`)
    shutdown(code ?? 0)
  })
}

startElectron()

/** Rebuild main/preload and restart Electron when electron/ or shared/ change. */
{
  let rebuildTimer = null
  const watchRoots = [path.join(root, 'electron'), path.join(root, 'shared')]
  const onWatch = (event, filename) => {
    if (shuttingDown || !filename) return
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(async () => {
      if (shuttingDown) return
      console.log(`[dev] electron/shared changed (${event}: ${filename}) — rebuilding`)
      try {
        await buildElectron()
      } catch (e) {
        console.error('[dev] electron rebuild failed', e)
        return
      }
      const old = electronChild
      if (!old || old.killed) {
        startElectron()
        console.log('[dev] Electron started')
        return
      }
      // Bump generation before kill so old exit handler is ignored.
      electronGeneration += 1
      electronChild = null
      trackPid(old.pid)
      try {
        if (process.platform === 'win32' && old.pid) {
          execSync(`taskkill /PID ${old.pid} /T /F`, { stdio: 'ignore' })
        } else {
          old.kill('SIGTERM')
        }
      } catch {
        /* ignore */
      }
      const idx = children.indexOf(old)
      if (idx >= 0) children.splice(idx, 1)
      startElectron()
      console.log('[dev] Electron restarted')
    }, 400)
  }
  for (const dir of watchRoots) {
    if (!fs.existsSync(dir)) continue
    fs.watch(dir, { recursive: true }, onWatch)
  }
}
