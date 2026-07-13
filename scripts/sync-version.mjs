import { readFile, writeFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = packageJson.version
const targets = [
  new URL('../website/index.html', import.meta.url),
  new URL('../website/en/index.html', import.meta.url)
]

for (const target of targets) {
  const current = await readFile(target, 'utf8')
  const next = current
    .replace(/"softwareVersion":\s*"[^"]+"/, `"softwareVersion": "${version}"`)
    .replace(/<span id="appVer">v[^<]+<\/span>/, `<span id="appVer">v${version}</span>`)

  if (next === current) {
    throw new Error(`Version markers were not found in ${target.pathname}`)
  }

  await writeFile(target, next)
  console.log(`Synced ${target.pathname} to v${version}`)
}
