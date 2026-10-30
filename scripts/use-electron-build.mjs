import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = process.argv[2] || process.env.NAVORA_ELECTRON_BUILD_DIR
if (!buildDir) throw new Error('Usage: npm run electron:use-build -- <Electron out/Release directory>')
const packageDir = path.join(root,'node_modules','electron')
const release = JSON.parse(fs.readFileSync(path.join(packageDir,'package.json'),'utf8')).version
const sourceDir = path.resolve(buildDir)
const sourceVersion = fs.readFileSync(path.join(sourceDir,'version'),'utf8').trim().replace(/^v/,'')
if (sourceVersion.split('.')[0] !== release.split('.')[0]) throw new Error('Electron build and installed package must have the same major version')
const executable = process.platform === 'win32' ? 'electron.exe' : 'electron'
const source = path.join(sourceDir,executable)
const destination = path.join(packageDir,'dist',executable)
if (fs.realpathSync(source) === fs.realpathSync(destination)) throw new Error('Build source must differ from installed executable')
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')
fs.copyFileSync(source,destination)
fs.writeFileSync(path.join(packageDir,'dist','navora-build.json'),JSON.stringify({release,sourceVersion,sha256,patches:['file-input-read-grants']},null,2))
console.log(JSON.stringify({release,sourceVersion,sha256,installed:true}))
