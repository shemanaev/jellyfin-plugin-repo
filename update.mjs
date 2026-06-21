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

function compareVersionDesc(a, b) {
  const aParts = String(a ?? '').split('.').map(x => Number.parseInt(x, 10) || 0)
  const bParts = String(b ?? '').split('.').map(x => Number.parseInt(x, 10) || 0)
  const length = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < length; i++) {
    const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }

  return 0
}

function comparePluginVersions(a, b) {
  return compareVersionDesc(a.version, b.version)
    || compareVersionDesc(a.targetAbi, b.targetAbi)
    || String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? ''))
}

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

    if (release.created_at < oldestVersion) {
      console.log(logSymbols.info, `${repo}: ${tag} too old, skipping`)
      continue
    }

    const assets = release.assets.filter(x => x.name.endsWith('.zip'))
    if (assets.length === 0) {
      console.warn(logSymbols.error, `${repo}: ${tag} asset not found`)
      break
    }

    for (const asset of assets) {
      const assetUrl = asset.browser_download_url
      const data = await (await fetch(assetUrl)).arrayBuffer()
      const buf = Buffer.from(data)
      const zip = new AdmZip(buf)
      const metaEntry = zip.getEntry('meta.json')
      if (metaEntry === null) {
        console.warn(logSymbols.warning, `${repo}: ${tag} ${asset.name} does not contain meta.json, skipping`)
        continue
      }

      const meta = JSON.parse(zip.readAsText(metaEntry))
      const hash = crypto.createHash('md5').update(buf).digest('hex')

      const versionExists = plugin.versions.some(x =>
        x.version === meta.version && (x.targetAbi ?? '') === (meta.targetAbi ?? ''))
      if (versionExists) {
        console.log(logSymbols.info, `${repo}: ${tag} ${meta.version} (${meta.targetAbi}) already present`)
        continue
      }

      const version = {
        version: meta.version,
        changelog: meta.changelog,
        targetAbi: meta.targetAbi,
        sourceUrl: assetUrl,
        checksum: hash,
        timestamp: meta.timestamp,
      }
      plugin.versions.push(version)

      console.log(logSymbols.success, `${repo}: ${tag} ${meta.version} (${meta.targetAbi}) added`)
    }
  }

  plugin.versions.sort(comparePluginVersions)
}

const output = JSON.stringify(manifest, null, 4) + '\n'
await fs.promises.writeFile('./manifest.json', output, 'utf-8')
