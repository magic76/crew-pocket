// Crew Pocket Popup Script - with Top-Right Export Menu
document.addEventListener('DOMContentLoaded', () => {
  const btnTabSeo = document.getElementById('btnTabSeo');
  const btnTabSlides = document.getElementById('btnTabSlides');
  const btnTabOptions = document.getElementById('btnTabOptions');

  const panelSeo = document.getElementById('panelSeo');
  const panelSlides = document.getElementById('panelSlides');
  const panelOptions = document.getElementById('panelOptions');

  const seoTitle = document.getElementById('seoTitle');
  const seoDesc = document.getElementById('seoDesc');
  const seoOg = document.getElementById('seoOg');
  const slidesContainer = document.getElementById('slidesContainer');
  const optionsContainer = document.getElementById('optionsContainer');

  const refreshBtn = document.getElementById('refreshBtn');
  const highlightBtn = document.getElementById('highlightBtn');
  const toast = document.getElementById('toast');

  // Menu Elements
  const menuBtn = document.getElementById('menuBtn');
  const dropdownMenu = document.getElementById('dropdownMenu');
  const copyRootPathBtn = document.getElementById('copyRootPathBtn');
  const copyZipPathBtn = document.getElementById('copyZipPathBtn');
  const copyDownloadPathBtn = document.getElementById('copyDownloadPathBtn');
  const copyDocumentsPathBtn = document.getElementById('copyDocumentsPathBtn');
  const copyTermuxCmdBtn = document.getElementById('copyTermuxCmdBtn');

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 2000);
  }

  function copyText(text, label) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`✅ 已複製 ${label}！`);
      dropdownMenu.classList.remove('open');
    });
  }

  // Toggle Dropdown Menu
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    dropdownMenu.classList.remove('open');
  });

  dropdownMenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Copy Menu Actions
  copyRootPathBtn.addEventListener('click', () => {
    copyText('/sdcard/crew-pocket-extension/', '內部儲存路徑');
  });

  copyZipPathBtn.addEventListener('click', () => {
    copyText('/sdcard/crew-pocket-extension/crew-pocket-bridge.zip', 'ZIP 壓縮包路徑');
  });

  copyDownloadPathBtn.addEventListener('click', () => {
    copyText('/sdcard/Download/crew-pocket-extension/', 'Download (下載) 目錄路徑');
  });

  copyDocumentsPathBtn.addEventListener('click', () => {
    copyText('/sdcard/Documents/crew-pocket-extension/', 'Documents (文件) 目錄路徑');
  });

  copyTermuxCmdBtn.addEventListener('click', () => {
    copyText('node ~/agy-web/server.js', 'Crew Pocket 啟動指令');
  });

  // Tab switching
  const tabs = [
    { btn: btnTabSeo, panel: panelSeo },
    { btn: btnTabSlides, panel: panelSlides },
    { btn: btnTabOptions, panel: panelOptions }
  ];

  tabs.forEach((tab, idx) => {
    tab.btn.addEventListener('click', () => {
      tabs.forEach((t, i) => {
        if (i === idx) {
          t.btn.classList.add('active');
          t.panel.classList.add('active');
        } else {
          t.btn.classList.remove('active');
          t.panel.classList.remove('active');
        }
      });
    });
  });

  async function getTargetTab() {
    let tabs = await chrome.tabs.query({ active: true });
    if (!tabs || tabs.length === 0) {
      tabs = await chrome.tabs.query({});
    }
    const webTab = tabs.find(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'));
    return webTab || tabs[0];
  }

  async function loadPageData() {
    seoTitle.textContent = '讀取中...';
    seoDesc.textContent = '讀取中...';
    seoOg.textContent = '讀取中...';
    slidesContainer.innerHTML = '<div class="item-box">正在解析輪播看板...</div>';
    optionsContainer.innerHTML = '<span class="tag">讀取中...</span>';

    const tab = await getTargetTab();
    if (!tab || !tab.id) {
      seoTitle.textContent = '未找到活動分頁，請先開啟網頁';
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {}

    chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_DATA' }, (res) => {
      const err = chrome.runtime.lastError;
      if (err || !res || !res.data) {
        seoTitle.textContent = tab.title || '（未命名網頁）';
        seoDesc.textContent = '⚠️ 請按「重新整理」網頁後重試。';
        seoOg.textContent = tab.url;
        return;
      }

      const d = res.data;

      // 1. SEO
      seoTitle.textContent = d.seo.title || tab.title || '（無標題）';
      seoDesc.textContent = d.seo.description || '（該網頁未設定 Meta Description）';
      seoOg.textContent = d.seo.ogTitle || d.seo.ogDesc || d.seo.title || '（無 OG 標籤）';

      // 2. Slides
      if (d.slides && d.slides.length > 0) {
        slidesContainer.innerHTML = '';
        d.slides.forEach((slide, idx) => {
          const div = document.createElement('div');
          div.className = 'item-box';
          div.innerHTML = `<div class="item-label" style="color:#38bdf8;">Slide #${idx + 1}</div><div style="color:#e2e8f0;font-size:11px;">${slide}</div>`;
          slidesContainer.appendChild(div);
        });
      } else {
        slidesContainer.innerHTML = '<div class="item-box" style="color:#94a3b8;">未偵測到明顯的輪播橫幅</div>';
      }

      // 3. Options
      if (d.options && d.options.length > 0) {
        optionsContainer.innerHTML = '';
        d.options.slice(0, 25).forEach(opt => {
          const span = document.createElement('span');
          span.className = 'tag';
          span.textContent = `🔘 ${opt.text}`;
          optionsContainer.appendChild(span);
        });
      } else {
        optionsContainer.innerHTML = '<span class="tag">未找到按鈕選項</span>';
      }
    });
  }

  // Refresh
  refreshBtn.addEventListener('click', loadPageData);

  // Highlight
  highlightBtn.addEventListener('click', async () => {
    const tab = await getTargetTab();
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'HIGHLIGHT_ALL' }, () => {
        highlightBtn.textContent = '✨ 已高亮！';
        setTimeout(() => highlightBtn.textContent = '✨ 高亮網頁按鈕', 2000);
      });
    }
  });

  loadPageData();
});
