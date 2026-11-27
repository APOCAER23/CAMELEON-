const repository = 'APOCAER23/CAMELEON-';
const latestReleaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;
const releasesUrl = `https://api.github.com/repos/${repository}/releases?per_page=6`;
const allReleasesUrl = `https://github.com/${repository}/releases`;
const platformNames = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

const elements = {
  downloadList: document.querySelector('#download-list'),
  downloadStatus: document.querySelector('#download-status'),
  heroVersion: document.querySelector('#hero-version'),
  releaseVersion: document.querySelector('#release-version'),
  releaseDate: document.querySelector('#release-date'),
  releaseSize: document.querySelector('#release-size'),
  releaseNotes: document.querySelector('#release-notes-link'),
  previousList: document.querySelector('#previous-list'),
  selectedPlatform: document.querySelector('#selected-platform'),
  panel: document.querySelector('#download-panel'),
  platformTitle: document.querySelector('#platform-title'),
};

let selectedPlatform = detectPlatform() || 'windows';
let downloadableAssets = {
  windows: [],
  macos: [],
  linux: [],
};
let currentRelease = null;

function detectPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/win/i.test(platform)) return 'windows';
  if (/mac|iphone|ipad/i.test(platform)) return 'macos';
  if (/linux/i.test(platform)) return 'linux';
  return null;
}

function classifyAsset(name) {
  const normalized = name.toLowerCase();
  if (normalized.endsWith('.exe') || normalized.endsWith('.msi')) return 'windows';
  if (normalized.endsWith('.dmg') || normalized.endsWith('.pkg')) return 'macos';
  if (
    normalized.endsWith('.appimage')
    || normalized.endsWith('.deb')
    || normalized.endsWith('.rpm')
  ) return 'linux';
  return null;
}

function safeDownloadUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'github.com') return url.href;
  } catch (error) {
    console.warn('Ignoring an invalid CAMELEON release asset URL:', error);
  }
  return null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size unavailable';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (typeof value !== 'string') return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not provided';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function getArchitecture(name, platform) {
  const normalized = name.toLowerCase();
  if (/arm64|aarch64/.test(normalized)) return 'ARM64';
  if (/universal/.test(normalized)) return 'Universal';
  if (/x64|x86_64|amd64/.test(normalized)) return 'x64';
  if (platform === 'macos') return 'Architecture not specified';
  return 'x64';
}

function getFormat(name) {
  const match = name.match(/\.(appimage|dmg|exe|msi|deb|rpm|pkg)$/i);
  return match ? match[1].toUpperCase() : 'Installer';
}

function getAvailableFormats(assets) {
  const formats = [...new Set(assets.map((asset) => getFormat(asset.name)))];
  return formats.length ? formats.join(' · ') : 'No files published';
}

function renderPlatformAvailability() {
  for (const [platform, assets] of Object.entries(downloadableAssets)) {
    const element = document.querySelector(`#${platform}-availability`);
    const count = assets.length;
    element.textContent = count
      ? `${count} ${count === 1 ? 'file' : 'files'} · ${getAvailableFormats(assets)}`
      : 'No installer published';
  }
}

function createDownloadItem(asset, platform) {
  const item = document.createElement('article');
  item.className = 'download-item';

  const details = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'file-name';
  name.textContent = asset.name;

  const metadata = document.createElement('p');
  metadata.className = 'file-meta';
  metadata.textContent = [
    getArchitecture(asset.name, platform),
    getFormat(asset.name),
    formatBytes(asset.size),
    currentRelease.tag_name,
  ].join(' · ');
  details.append(name, metadata);

  const link = document.createElement('a');
  link.className = 'download-button';
  link.href = safeDownloadUrl(asset.browser_download_url);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Download ${asset.name}`);
  link.innerHTML = 'Download <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"></path></svg>';

  item.append(details, link);
  return item;
}

function renderSelectedPlatform() {
  const assets = downloadableAssets[selectedPlatform];
  const platformName = platformNames[selectedPlatform];
  elements.selectedPlatform.textContent = platformName;
  elements.panel.setAttribute('aria-labelledby', `os-${selectedPlatform}`);
  elements.platformTitle.textContent = assets.length
    ? 'Available downloads'
    : 'No installer in this release';
  elements.downloadList.replaceChildren();

  if (!assets.length) {
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = `There are no ${platformName} installers in the latest published release.`;
    elements.downloadList.append(message);
    elements.downloadStatus.textContent = `No ${platformName} files are currently available.`;
    return;
  }

  for (const asset of assets) {
    elements.downloadList.append(createDownloadItem(asset, selectedPlatform));
  }
  elements.downloadStatus.textContent = `${assets.length} ${assets.length === 1 ? 'file' : 'files'} for ${platformName}`;
}

function selectPlatform(platform) {
  selectedPlatform = platform;
  for (const button of document.querySelectorAll('.os-option')) {
    const selected = button.dataset.os === platform;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  renderSelectedPlatform();
}

function renderReleaseInfo(release) {
  const supportedAssets = Object.values(downloadableAssets).flat();
  const totalSize = supportedAssets.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0);

  elements.heroVersion.textContent = `Latest release ${release.tag_name}`;
  elements.releaseVersion.textContent = release.tag_name;
  elements.releaseDate.textContent = formatDate(release.published_at);
  elements.releaseSize.textContent = supportedAssets.length
    ? `${formatBytes(totalSize)} · ${supportedAssets.length} installers`
    : 'No installers published';
  elements.releaseNotes.href = release.html_url;

  const compatibility = Object.entries(downloadableAssets).map(([platform, assets]) => {
    if (!assets.length) return `${platformNames[platform]}: no installer`;
    const architectures = [...new Set(assets.map((asset) => getArchitecture(asset.name, platform)))];
    return `${platformNames[platform]}: ${architectures.join(', ')}`;
  });
  document.querySelector('#requirements-copy').textContent =
    `${compatibility.join(' · ')}. Minimum operating system versions are not currently published.`;

  const macArchitectures = downloadableAssets.macos
    .map((asset) => getArchitecture(asset.name, 'macos'));
  const macosCompatibility = document.querySelector('#macos-compatibility');
  if (!macArchitectures.length) {
    macosCompatibility.textContent = 'No macOS installer is available in the latest release.';
  } else if (macArchitectures.includes('Universal') || (
    macArchitectures.includes('ARM64') && macArchitectures.includes('x64')
  )) {
    macosCompatibility.textContent = 'The latest release includes builds for Apple Silicon and Intel Macs.';
  } else if (macArchitectures.includes('ARM64')) {
    macosCompatibility.textContent = 'The latest release includes Apple Silicon (ARM64). An Intel installer is not available.';
  } else if (macArchitectures.includes('x64')) {
    macosCompatibility.textContent = 'The latest release includes Intel (x64). An Apple Silicon installer is not available.';
  } else {
    macosCompatibility.textContent = 'The macOS architecture is not specified in the published file name.';
  }
}

async function loadLatestRelease() {
  const response = await fetch(latestReleaseUrl, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });

  if (response.status === 404) {
    throw new Error('No public CAMELEON release has been published yet.');
  }
  if (!response.ok) {
    throw new Error(`GitHub Releases returned HTTP ${response.status}.`);
  }

  const release = await response.json();
  if (typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
    throw new Error('GitHub Releases returned an unexpected response.');
  }

  currentRelease = release;
  downloadableAssets = { windows: [], macos: [], linux: [] };
  for (const asset of release.assets) {
    if (asset.state !== 'uploaded' || typeof asset.name !== 'string') continue;
    const platform = classifyAsset(asset.name);
    const url = safeDownloadUrl(asset.browser_download_url);
    if (!platform || !url) continue;
    downloadableAssets[platform].push({ ...asset, browser_download_url: url });
  }

  renderPlatformAvailability();
  renderReleaseInfo(release);
  selectPlatform(selectedPlatform);
}

async function loadPreviousReleases() {
  const response = await fetch(releasesUrl, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Release history returned HTTP ${response.status}.`);
  }

  const releases = await response.json();
  const currentTag = currentRelease?.tag_name
    || releases.find((release) => !release.draft && !release.prerelease)?.tag_name;
  const previous = releases
    .filter((release) => !release.draft && !release.prerelease && release.tag_name !== currentTag)
    .slice(0, 4);

  elements.previousList.replaceChildren();
  if (!previous.length) {
    const item = document.createElement('li');
    item.className = 'empty-state';
    item.textContent = 'No previous public versions yet.';
    elements.previousList.append(item);
    return;
  }

  for (const release of previous) {
    const url = safeDownloadUrl(release.html_url);
    if (!url) continue;
    const item = document.createElement('li');
    item.className = 'previous-release';
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = release.tag_name;
    const date = document.createElement('span');
    date.textContent = formatDate(release.published_at);
    item.append(link, date);
    elements.previousList.append(item);
  }
}

function setupThemeToggle() {
  const button = document.querySelector('#theme-toggle');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const updateThemeColor = () => {
    themeColor.content = document.documentElement.dataset.theme === 'dark' ? '#101311' : '#fbfcfb';
  };
  updateThemeColor();
  button.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    updateThemeColor();
    button.setAttribute('aria-label', `Switch to ${nextTheme === 'dark' ? 'light' : 'dark'} theme`);
    try {
      localStorage.setItem('cameleon-theme', nextTheme);
    } catch (error) {
      console.warn('Unable to save the selected CAMELEON theme:', error);
    }
  });
}

function setupMobileNavigation() {
  const button = document.querySelector('#mobile-menu-toggle');
  const navigation = document.querySelector('.main-nav');
  const closeMenu = () => {
    navigation.classList.remove('menu-open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open navigation menu');
  };

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    navigation.classList.toggle('menu-open', !expanded);
    button.setAttribute('aria-expanded', String(!expanded));
    button.setAttribute('aria-label', expanded ? 'Open navigation menu' : 'Close navigation menu');
  });
  document.querySelectorAll('#nav-links a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      button.focus();
    }
  });
}

function setupPlatformSelector() {
  const buttons = [...document.querySelectorAll('.os-option')];
  for (const [index, button] of buttons.entries()) {
    button.addEventListener('click', () => selectPlatform(button.dataset.os));
    button.addEventListener('keydown', (event) => {
      let nextIndex = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (index + 1) % buttons.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (index + buttons.length - 1) % buttons.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = buttons.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      buttons[nextIndex].focus();
      selectPlatform(buttons[nextIndex].dataset.os);
    });
  }
  selectPlatform(selectedPlatform);
}

function showReleaseError(error) {
  console.error('Unable to load CAMELEON release downloads:', error);
  elements.heroVersion.textContent = 'Release information unavailable';
  elements.releaseVersion.textContent = 'Unavailable';
  elements.releaseDate.textContent = 'Unavailable';
  elements.releaseSize.textContent = 'Unavailable';
  elements.downloadStatus.textContent = 'Could not load the latest release.';
  for (const platform of Object.keys(platformNames)) {
    document.querySelector(`#${platform}-availability`).textContent = 'Unavailable';
  }
  document.querySelector('#macos-compatibility').textContent =
    'Could not load the latest release to check which Mac architectures are available.';
  elements.downloadList.replaceChildren();
  const message = document.createElement('p');
  message.className = 'empty-state';
  message.textContent = 'Please use the official GitHub Releases page to see available downloads.';
  elements.downloadList.append(message);
}

async function initialize() {
  setupThemeToggle();
  setupMobileNavigation();
  setupPlatformSelector();

  try {
    await loadLatestRelease();
  } catch (error) {
    showReleaseError(error);
  }

  try {
    await loadPreviousReleases();
  } catch (error) {
    console.error('Unable to load CAMELEON release history:', error);
    elements.previousList.replaceChildren();
    const item = document.createElement('li');
    item.className = 'empty-state';
    item.textContent = 'Release history is temporarily unavailable. See all versions on GitHub.';
    elements.previousList.append(item);
  }
}

initialize();
