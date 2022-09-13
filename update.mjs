import fs from 'fs'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import logSymbols from 'log-symbols'

async function getFromGhApi(repo, what) {
  const url = `https://api.github.com/repos/${repo}/${what}`
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json'
    },
  })
  return await response.json()
}

const repos = JSON.parse(await fs.promises.readFile('./repos.json', 'utf-8'))
const manifest = JSON.parse(await fs.promises.readFile('./manifest.json', 'utf-8'))

for (const repo in repos) {
  const guid = repos[repo]
  const plugin = manifest.find(x => x.guid === guid)
  if (plugin === undefined) {
    console.warn(logSymbols.error, `Pluging ${guid} not found in manifest`)
    break
  }

  const oldestVersion = plugin.versions
    .reduce((prev, current) => (prev.timestamp < current.timestamp) ? prev : current)
    .timestamp

  const releases = await getFromGhApi(repo, 'releases')
  for (const release of releases) {
    const tag = release.tag_name.replace(/^v/, '')
    const tagV = tag.replace(/^v/, '')

    if (release.created_at < oldestVersion) {
      console.log(logSymbols.info, `${repo}: ${tag} too old, skipping`)
      continue
    }

    const vIdx = plugin.versions.findIndex(x => x.version === tagV)
    if (vIdx > -1) {
      // version exists in manifest
      console.log(logSymbols.info, `${repo}: ${tag} already present`)
      continue
    }

    const asset = release.assets.find(x => x.name.endsWith('.zip'))
    if (asset === undefined) {
      console.warn(logSymbols.error, `${repo}: ${tag} asset not found`)
      break
    }

    const assetUrl = asset.browser_download_url
    const data = await (await fetch(assetUrl)).arrayBuffer()
    const buf = Buffer.from(data)
    const zip = new AdmZip(buf)

    const meta = JSON.parse(zip.readAsText('meta.json'))
    const hash = crypto.createHash('md5').update(buf).digest('hex')

    const version = {
      version: meta.version,
      changelog: meta.changelog,
      targetAbi: meta.targetAbi,
      sourceUrl: assetUrl,
      checksum: hash,
      timestamp: meta.timestamp,
    }
    plugin.versions.unshift(version)

    console.log(logSymbols.success, `${repo}: ${tag} added`)
  }
}

const output = JSON.stringify(manifest, null, 4) + '\n'
await fs.promises.writeFile('./manifest.json', output, 'utf-8')
