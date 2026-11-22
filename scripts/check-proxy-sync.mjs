// Guard against drift between the canonical server/p4 and the Pages-contained copies.
import { readFile } from 'node:fs/promises'
const names = ['filings.js', 'pipeline.js', 'openrouter.js']
for (const name of names) {
  const [source, deployed] = await Promise.all([
    readFile(new URL('../server/p4/' + name, import.meta.url)),
    readFile(new URL('../stockpeek-proxy/lib/' + name, import.meta.url))
  ])
  if (!source.equals(deployed)) {
    process.stderr.write('P4 Pages copy out of sync: ' + name + '\n')
    process.exitCode = 1
  }
}
if (!process.exitCode) process.stdout.write('Pages P4 copies match canonical server modules.\n')
