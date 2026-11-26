const releaseUrl = 'https://github.com/APOCAER23/CAMELEON-/releases/latest';
const apiUrl = 'https://api.github.com/repos/APOCAER23/CAMELEON-/releases/latest';

const releaseStatus = document.querySelector('#release-status');
const releaseVersion = document.querySelector('#release-version');
const platformStateIds = ['windows-state', 'mac-state', 'linux-state'];

function setPlatformMessage(message) {
  for (const id of platformStateIds) {
    document.querySelector(`#${id}`).textContent = message;
  }
}

function findAsset(assets, extension) {
  return assets.find((asset) => asset.name.toLowerCase().endsWith(extension));
}

function makeDownloadLink(asset, label, secondary = false) {
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;

  const link = document.createElement('a');
  link.className = secondary ? 'download-button secondary' : 'download-button';
  link.href = url.href;
  link.textContent = label;
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Télécharger ${asset.name}`);
  return link;
}

function showPlatformDownloads(containerId, stateId, entries) {
  const container = document.querySelector(`#${containerId}`);
  const state = document.querySelector(`#${stateId}`);
  let added = 0;

  for (const [asset, label] of entries) {
    if (!asset) continue;
    const link = makeDownloadLink(asset, label, added > 0);
    if (!link) continue;
    container.append(link);
    added += 1;
  }

  if (added > 0) {
    state.hidden = true;
  } else {
    state.textContent = 'Aucun fichier disponible pour le moment.';
  }

  return added;
}

async function loadDownloads() {
  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });

    if (response.status === 404) {
      releaseStatus.textContent = 'La première version téléchargeable n’est pas encore publiée.';
      releaseVersion.textContent = 'bientôt disponible';
      setPlatformMessage('Aucun téléchargement publié pour le moment.');
      return;
    }

    if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);

    const release = await response.json();
    if (typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
      throw new Error('GitHub Releases returned an unexpected response');
    }

    releaseVersion.textContent = release.tag_name;
    releaseStatus.textContent = `Téléchargements de la version ${release.tag_name}.`;

    const windows = findAsset(release.assets, '.exe');
    const mac = findAsset(release.assets, '.dmg');
    const appImage = findAsset(release.assets, '.appimage');

    const available = showPlatformDownloads('windows-actions', 'windows-state', [
      [windows, 'Télécharger pour Windows ↓'],
    ]) + showPlatformDownloads('mac-actions', 'mac-state', [
      [mac, 'Télécharger pour macOS ↓'],
    ]) + showPlatformDownloads('linux-actions', 'linux-state', [
      [appImage, 'AppImage ↓'],
    ]);

    if (available === 0) {
      releaseStatus.textContent = 'Les installateurs ne sont pas encore disponibles pour cette version.';
    }
  } catch (error) {
    console.error('Unable to load CAMELEON release downloads:', error);
    releaseStatus.textContent = 'Impossible de charger les liens automatiquement. Consulte les Releases GitHub.';
    releaseVersion.textContent = 'indisponible';
    setPlatformMessage('Consulte les Releases GitHub.');
  }
}

loadDownloads();
