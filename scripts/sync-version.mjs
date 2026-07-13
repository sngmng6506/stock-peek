import { readFile, writeFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = packageJson.version
const today = new Date().toISOString().slice(0, 10)

const versionTargets = [
  new URL('../website/index.html', import.meta.url),
  new URL('../website/en.html', import.meta.url),
  new URL('../website/releases/index.html', import.meta.url),
  new URL('../website/en/releases/index.html', import.meta.url)
]

const datedTargets = [
  new URL('../website/index.html', import.meta.url),
  new URL('../website/en.html', import.meta.url),
  new URL('../website/guide/index.html', import.meta.url),
  new URL('../website/en/guide/index.html', import.meta.url),
  new URL('../website/releases/index.html', import.meta.url),
  new URL('../website/en/releases/index.html', import.meta.url),
  new URL('../website/privacy/index.html', import.meta.url),
  new URL('../website/en/privacy/index.html', import.meta.url)
]

for (const target of versionTargets) {
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

for (const target of datedTargets) {
  const current = await readFile(target, 'utf8')
  const next = current.replace(/"dateModified":\s*"\d{4}-\d{2}-\d{2}"/g, `"dateModified": "${today}"`)

  if (next === current && !current.includes(`"dateModified": "${today}"`)) {
    throw new Error(`dateModified marker was not found in ${target.pathname}`)
  }

  await writeFile(target, next)
  console.log(`Updated ${target.pathname} dateModified to ${today}`)
}

const sitemapTarget = new URL('../website/sitemap.xml', import.meta.url)
const sitemapCurrent = await readFile(sitemapTarget, 'utf8')
const sitemapNext = sitemapCurrent.replace(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, `<lastmod>${today}</lastmod>`)

if (sitemapNext === sitemapCurrent && !sitemapCurrent.includes(`<lastmod>${today}</lastmod>`)) {
  throw new Error('Sitemap lastmod markers were not found')
}

await writeFile(sitemapTarget, sitemapNext)
console.log(`Updated sitemap lastmod values to ${today}`)
