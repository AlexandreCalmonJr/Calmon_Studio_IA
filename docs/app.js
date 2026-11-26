const REPO = 'AlexandreCalmonJr/Frontend_JarvisHub';
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

function detectOS() {
  const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}

function setActiveTab(os) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.os === os;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === os);
  });
}

function findAssetUrl(assets, matcher) {
  const found = assets.find((asset) => matcher(asset.name.toLowerCase()));
  return found ? found.browser_download_url : null;
}

function applyReleaseAssets(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const tagName = release?.tag_name || 'v3.0.1';

  const badge = document.getElementById('release-badge');
  if (badge) {
    badge.textContent = `Versão ${tagName} • Desktop Local-First`;
  }

  const status = document.getElementById('release-status');
  if (status) {
    status.textContent = assets.length
      ? `Release ${tagName} disponível para download direto.`
      : `Release ${tagName} encontrada. Clique para abrir os arquivos no GitHub.`;
  }

  const map = {
    'win-setup': findAssetUrl(assets, (n) => n.endsWith('-setup.exe') || n.endsWith('-nsis.exe')),
    'win-portable': findAssetUrl(assets, (n) => n.endsWith('-portable.exe')),
    'linux-appimage': findAssetUrl(assets, (n) => n.endsWith('.appimage')),
    'mac-dmg-arm64': findAssetUrl(assets, (n) => n.includes('arm64') && n.endsWith('.dmg')),
    'mac-dmg-x64': findAssetUrl(assets, (n) => n.includes('x64') && n.endsWith('.dmg')),
    'mac-zip-arm64': findAssetUrl(assets, (n) => n.includes('arm64') && n.endsWith('.zip')),
    'mac-zip-x64': findAssetUrl(assets, (n) => n.includes('x64') && n.endsWith('.zip')),
  };

  document.querySelectorAll('.dl-link').forEach((el) => {
    const key = el.dataset.asset;
    const url = map[key] || release?.html_url || RELEASES_PAGE;
    el.href = url;
  });

  return map;
}

function updatePrimaryCta(os, assetMap) {
  const primaryBtn = document.getElementById('primary-download-btn');
  const osHint = document.getElementById('detected-os-hint');
  if (!primaryBtn || !osHint) return;

  const labels = {
    windows: { btn: 'Baixar para Windows (.exe)', hint: 'Sistema detectado: Windows (x64)', key: 'win-setup' },
    linux: { btn: 'Baixar para Linux (.AppImage)', hint: 'Sistema detectado: Linux (x64)', key: 'linux-appimage' },
    macos: { btn: 'Baixar para macOS (.dmg)', hint: 'Sistema detectado: macOS', key: 'mac-dmg-arm64' },
  };

  const info = labels[os] || labels.windows;
  primaryBtn.textContent = info.btn;
  osHint.textContent = info.hint;

  if (assetMap && assetMap[info.key]) {
    primaryBtn.href = assetMap[info.key];
    primaryBtn.target = '_blank';
    primaryBtn.rel = 'noopener noreferrer';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const detectedOs = detectOS();
  setActiveTab(detectedOs);
  updatePrimaryCta(detectedOs, null);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.os));
  });

  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = await res.json();
    const assetMap = applyReleaseAssets(release);
    updatePrimaryCta(detectedOs, assetMap);
  } catch {
    const status = document.getElementById('release-status');
    if (status) {
      status.innerHTML = `Publique uma tag <code>v*</code> para habilitar os links diretos, ou acesse a <a href="${RELEASES_PAGE}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">página de Releases</a>.`;
    }
  }
});
