import { readFile, writeFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = packageJson.version
const targets = [
  new URL('../website/index.html', import.meta.url),
  new URL('../website/en.html', import.meta.url),
  new URL('../website/releases/index.html', import.meta.url),
  new URL('../website/en/releases/index.html', import.meta.url)
]

for (const target of targets) {
  const current = await readFile(target, 'utf8')
  let next = current

  if (/"softwareVersion":\s*"[^"]+"/.test(next)) {
    next = next.replace(/"softwareVersion":\s*"[^"]+"/, `"softwareVersion": "${version}"`)
  }

  if (/<span id="appVer">v[^<]+<\/span>/.test(next)) {
    next = next.replace(/<span id="appVer">v[^<]+<\/span>/, `<span id="appVer">v${version}</span>`)
  }

  if (next === current) {
    throw new Error(`Version markers were not found in ${target.pathname}`)
  }

  await writeFile(target, next)
  console.log(`Synced ${target.pathname} to v${version}`)
}
