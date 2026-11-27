import { readFile, writeFile } from 'node:fs/promises';

const [latestPath, releasesPath, outputPath] = process.argv.slice(2);
if (!latestPath || !releasesPath || !outputPath) {
  throw new Error('Usage: node scripts/update-site-releases.mjs <latest.json> <releases.json> <output.json>');
}

const latest = JSON.parse(await readFile(latestPath, 'utf8'));
const releases = JSON.parse(await readFile(releasesPath, 'utf8'));
if (!Array.isArray(latest.assets) || !Array.isArray(releases)) {
  throw new Error('GitHub returned an unexpected release response.');
}

function githubUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : null;
  } catch {
    return null;
  }
}

function isInstaller(name) {
  return /\.(exe|msi|dmg|pkg|appimage|deb|rpm)$/i.test(name);
}

function releaseInfo(release) {
  const htmlUrl = githubUrl(release.html_url);
  if (
    typeof release.tag_name !== 'string'
    || typeof release.published_at !== 'string'
    || !htmlUrl
  ) {
    throw new Error('A release is missing its tag, publication date, or valid GitHub URL.');
  }

  return {
    tag_name: release.tag_name,
    published_at: release.published_at,
    html_url: htmlUrl,
  };
}

const releaseAssets = latest.assets
  .filter((asset) => asset.state === 'uploaded' && typeof asset.name === 'string' && isInstaller(asset.name))
  .map((asset) => {
    const url = githubUrl(asset.browser_download_url);
    if (!url || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Release asset metadata is invalid: ${asset.name}`);
    }
    return {
      name: asset.name,
      size: asset.size,
      browser_download_url: url,
    };
  });

if (!releaseAssets.length) {
  throw new Error(`No supported installer assets found in ${latest.tag_name || 'the latest release'}.`);
}

const previousReleases = releases
  .filter((release) => (
    !release.draft
    && !release.prerelease
    && release.tag_name !== latest.tag_name
    && typeof release.published_at === 'string'
  ))
  .slice(0, 4)
  .map(releaseInfo);

const manifest = {
  schema_version: 1,
  release: {
    ...releaseInfo(latest),
    assets: releaseAssets,
  },
  previous_releases: previousReleases,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
