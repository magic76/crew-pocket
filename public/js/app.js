// Antigravity Web UI - Main Application Entrypoint & Bootstrap

// 1. Marked.js configuration (Table Responsive Wrapper)
if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  const originalTable = renderer.table.bind(renderer);
  renderer.table = function(header, body) {
    const tableHtml = originalTable(header, body);
    return `<div class="table-wrapper">${tableHtml}</div>`;
  };
  marked.setOptions({
    renderer: renderer,
    breaks: true,
    gfm: true
  });
}

// 2. Service Worker Registration (Offline & Push Notifications)
if ('serviceWorker' in navigator) {
  let reloadingForNewServiceWorker = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The new worker has already precached this build. Reload once so this tab
    // cannot continue executing an old in-memory JS bundle after an update.
    if (!reloadingForNewServiceWorker) {
      reloadingForNewServiceWorker = true;
      window.location.reload();
    }
  });

  navigator.serviceWorker.register('/sw.js?v=20260829-pwa2', { updateViaCache: 'none' }).then(reg => {
    swRegistration = reg;
    reg.update().catch(() => {});
    // Pick up a deployment even when this PWA has remained open for hours.
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(err => {
    console.warn('SW registration failed:', err);
  });
}

// 3. Real-time Network Connectivity Monitor
let isOnline = navigator.onLine;

function updateNetworkUI(online) {
  isOnline = online;
  if (online) {
    if (networkDot) {
      networkDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0';
      networkDot.title = '網路連線正常 (可正常與 AI 對話)';
    }
    if (networkOfflineBadge) networkOfflineBadge.classList.add('hidden');
  } else {
    if (networkDot) {
      networkDot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0';
      networkDot.title = '手機無網路連線 (請檢查 Wi-Fi/行動數據)';
    }
    if (networkOfflineBadge) networkOfflineBadge.classList.remove('hidden');
  }
}

window.addEventListener('online', () => {
  updateNetworkUI(true);
  if (navigator.vibrate) navigator.vibrate(20);
});

window.addEventListener('offline', () => {
  updateNetworkUI(false);
  if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
});

updateNetworkUI(navigator.onLine);

// 4. Bind Global UI Listeners
function initAppAndListeners() {
  // 🚀 Holographic Quantum Splash Screen Dismissal (Option 1)
  const splashScreen = document.getElementById('app-splash-screen');
  if (splashScreen) {
    if (typeof window.haptic === 'function') window.haptic('medium');
    setTimeout(() => {
      splashScreen.classList.add('splash-dismissed');
      setTimeout(() => {
        if (splashScreen && splashScreen.parentNode) splashScreen.remove();
      }, 500);
    }, 950);
  }

  // Drawer listeners
  if (menuBtn) menuBtn.addEventListener('click', () => toggleDrawer(true));
  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', () => toggleDrawer(false));
  if (drawerOverlay) drawerOverlay.addEventListener('click', () => toggleDrawer(false));

  // Lightbox listeners
  if (closeLightboxBtn) closeLightboxBtn.addEventListener('click', () => lightbox.classList.add('opacity-0', 'pointer-events-none'));
  if (lightbox) lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.classList.add('opacity-0', 'pointer-events-none'); });

  // 🧰 Tools Menu Dropdown listeners
  if (toolsMenuBtn && toolsMenuDropdown) {
    toolsMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.haptic === 'function') window.haptic('light');
      toolsMenuDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!toolsMenuDropdown.contains(e.target) && !toolsMenuBtn.contains(e.target)) {
        toolsMenuDropdown.classList.add('hidden');
      }
    });

    [newChatBtn, filesBtn, storageBtn, usageBtn, cheatSheetBtn, notifyBtn, exportExtBtn].forEach(btn => {
      if (btn) btn.addEventListener('click', () => {
        if (typeof window.haptic === 'function') window.haptic('light');
        toolsMenuDropdown.classList.add('hidden');
      });
    });
  }

  // 📦 Browser Extension Export listeners
  if (exportExtBtn) exportExtBtn.addEventListener('click', () => toggleExportExtModal(true));
  if (closeExportExtBtn) closeExportExtBtn.addEventListener('click', () => toggleExportExtModal(false));
  if (exportExtModal) exportExtModal.addEventListener('click', (e) => { if (e.target === exportExtModal) toggleExportExtModal(false); });

  if (doExportExtBtn) {
    doExportExtBtn.addEventListener('click', async () => {
      if (typeof window.haptic === 'function') window.haptic('medium');
      const selected = document.querySelector('input[name="ext-target-dest"]:checked');
      const targetDir = selected ? selected.value : '/sdcard/crew-pocket-extension';
      
      const originalText = doExportExtBtn.innerHTML;
      doExportExtBtn.disabled = true;
      doExportExtBtn.innerHTML = '<span>⏳ 正在複製套件檔案...</span>';

      try {
        const res = await fetch('/api/export-extension', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetDir })
        });
        const data = await res.json();
        
        if (data.success) {
          if (typeof window.haptic === 'function') window.haptic('success');
          if (exportExtStatus) {
            exportExtStatus.innerHTML = `✅ 成功匯出 ${data.filesCount} 個檔案至：<br><strong class="font-mono text-cyan-300">${data.targetDir}</strong><br><span class="text-[10px] text-slate-300">現在可以直接在 Lemur 選擇此目錄載入套件！</span>`;
            exportExtStatus.classList.remove('hidden');
          }
        } else {
          if (exportExtStatus) {
            exportExtStatus.innerHTML = `❌ 匯出失敗: ${data.error}`;
            exportExtStatus.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (exportExtStatus) {
          exportExtStatus.innerHTML = `❌ 連線錯誤: ${err.message}`;
          exportExtStatus.classList.remove('hidden');
        }
      } finally {
        doExportExtBtn.disabled = false;
        doExportExtBtn.innerHTML = originalText;
      }
    });
  }

  // Cheat Sheet listeners
  if (cheatSheetBtn) cheatSheetBtn.addEventListener('click', () => toggleCheatSheet(true));
  if (openCheatChip) openCheatChip.addEventListener('click', () => toggleCheatSheet(true));
  if (closeCheatSheetBtn) closeCheatSheetBtn.addEventListener('click', () => toggleCheatSheet(false));
  if (cheatSheetModal) cheatSheetModal.addEventListener('click', (e) => { if (e.target === cheatSheetModal) toggleCheatSheet(false); });

  // Usage Modal listeners
  if (usageBtn) usageBtn.addEventListener('click', () => toggleUsageModal(true));
  if (openUsageChip) openUsageChip.addEventListener('click', () => toggleUsageModal(true));
  if (closeUsageBtn) closeUsageBtn.addEventListener('click', () => toggleUsageModal(false));
  if (refreshUsageBtn) refreshUsageBtn.addEventListener('click', loadUsageData);
  if (usageModal) usageModal.addEventListener('click', (e) => { if (e.target === usageModal) toggleUsageModal(false); });

  // Context Usage Modal listeners
  const contextPill = document.getElementById('context-pill');
  const contextModal = document.getElementById('context-modal');
  const closeContextBtn = document.getElementById('close-context-btn');
  const modalTriggerCompactBtn = document.getElementById('modal-trigger-compact-btn');
  const modalTriggerCompactMaxBtn = document.getElementById('modal-trigger-compact-max-btn');

  const runCompactFromContext = (command) => {
    if (typeof window.hideContextModal === 'function') window.hideContextModal();
    if (promptInput) {
      promptInput.value = command;
      promptInput.focus();
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
    }
    if (typeof handleSendClick === 'function') handleSendClick(new Event('click'));
  };

  if (contextPill) {
    contextPill.addEventListener('click', () => {
      if (typeof window.showContextModal === 'function') window.showContextModal();
    });
  }
  if (closeContextBtn) {
    closeContextBtn.addEventListener('click', () => {
      if (typeof window.hideContextModal === 'function') window.hideContextModal();
    });
  }
  if (contextModal) {
    contextModal.addEventListener('click', (e) => {
      if (e.target === contextModal && typeof window.hideContextModal === 'function') {
        window.hideContextModal();
      }
    });
  }
  if (modalTriggerCompactBtn) {
    modalTriggerCompactBtn.addEventListener('click', () => runCompactFromContext('/compact'));
  }
  if (modalTriggerCompactMaxBtn) modalTriggerCompactMaxBtn.addEventListener('click', () => {
    if (currentProvider === 'codex' && typeof window.startLowContextContinuation === 'function') {
      window.startLowContextContinuation(modalTriggerCompactMaxBtn);
    } else {
      runCompactFromContext('/compact-max');
    }
  });

  // Model & Effort Selector listeners
  if (modelSelectorBtn) modelSelectorBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleModelModal(true); });
  if (effortSelectorBtn) effortSelectorBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleModelModal(true); });
  if (closeModelBtn) closeModelBtn.addEventListener('click', () => toggleModelModal(false));
  if (modelModal) modelModal.addEventListener('click', (e) => { if (e.target === modelModal) toggleModelModal(false); });

  // Files Explorer Modal listeners
  const openFilesExplorer = () => {
    // This launcher lives inside the tools popover. Hide that z-50 layer
    // before showing another z-50 modal, then wait one frame for mobile
    // compositors to settle instead of flashing between the two surfaces.
    if (toolsMenuDropdown) toolsMenuDropdown.classList.add('hidden');
    if (drawer && !drawer.classList.contains('-translate-x-full')) toggleDrawer(false);
    window.requestAnimationFrame(() => toggleFilesModal(true));
  };
  if (filesBtn) filesBtn.addEventListener('click', openFilesExplorer);
  if (openFilesChip) openFilesChip.addEventListener('click', () => toggleFilesModal(true));
  if (closeFilesBtn) closeFilesBtn.addEventListener('click', () => toggleFilesModal(false));
  if (refreshFilesBtn) refreshFilesBtn.addEventListener('click', () => loadDirectory(currentExplorerPath));
  if (filesModal) filesModal.addEventListener('click', (e) => { if (e.target === filesModal) toggleFilesModal(false); });
  if (closePreviewPaneBtn) closePreviewPaneBtn.addEventListener('click', () => { if (filePreviewPane) filePreviewPane.classList.add('hidden'); });
  if (previewSendAiBtn) previewSendAiBtn.addEventListener('click', () => sendPathToAI(currentPreviewFullPath, currentPreviewFileName));
  if (previewCopyBtn && previewFileContent) previewCopyBtn.addEventListener('click', () => copyToClipboard(previewFileContent.textContent, previewCopyBtn));

  // Notification Button
  if (notifyBtn) {
    updateNotifyBtnUI();
    notifyBtn.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        alert('您的瀏覽器不支援 Web Notifications');
        return;
      }
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        notificationsEnabled = (perm === 'granted');
        if (perm === 'granted') {
          triggerDoneNotification('系統通知功能已成功啟用！🎉');
        }
      } else if (Notification.permission === 'granted') {
        notificationsEnabled = !notificationsEnabled;
        if (notificationsEnabled) {
          triggerDoneNotification('系統通知已重新開啟！');
        }
      } else {
        alert('請在瀏覽器網址列設定（鎖頭圖示）中允許此網站發送通知。');
        return;
      }
      localStorage.setItem('agy_notify_enabled', notificationsEnabled);
      updateNotifyBtnUI();
    });
  }

  // Scroll tracker with Scroll-To-Bottom FAB (Idea 2)
  if (messagesContainer) {
    const scrollBtn = document.getElementById('scroll-bottom-btn');
    const scrollBadge = document.getElementById('scroll-bottom-badge');

    messagesContainer.addEventListener('scroll', () => {
      const threshold = 120;
      const distanceFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
      const isAtBottom = distanceFromBottom <= threshold;
      userScrolledUp = !isAtBottom;

      if (scrollBtn) {
        if (!isAtBottom) {
          scrollBtn.classList.remove('hidden-fab');
          scrollBtn.classList.add('visible');
        } else {
          scrollBtn.classList.remove('visible');
          scrollBtn.classList.add('hidden-fab');
          if (scrollBadge) scrollBadge.classList.add('hidden');
        }
      }
    });

    if (scrollBtn) {
      scrollBtn.addEventListener('click', () => {
        messagesContainer.scrollTo({
          top: messagesContainer.scrollHeight,
          behavior: 'smooth'
        });
        userScrolledUp = false;
        if (navigator.vibrate) navigator.vibrate(20);
        if (scrollBadge) scrollBadge.classList.add('hidden');
      });
    }
  }

  // Prompt Input Auto-resize & Slash Menu
  if (promptInput) {
    promptInput.addEventListener('input', () => {
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
      if (typeof updateSendButtonMode === 'function') updateSendButtonMode();
      const val = promptInput.value.trim();
      if (val.startsWith('/') && !val.includes(' ')) {
        if (slashMenu) slashMenu.classList.remove('hidden');
      } else {
        if (slashMenu) slashMenu.classList.add('hidden');
      }
    });

    // Enter key: purely insert newline (Ctrl+Enter or Cmd+Enter to send)
    promptInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (slashMenu) slashMenu.classList.add('hidden');
        handleSendClick(e);
      }
    });
  }

  // Slash Command Buttons
  document.querySelectorAll('.slash-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const cmd = btn.dataset.cmd;

      if (action === 'clear' || cmd === '/clear') {
        if (promptInput) {
          promptInput.value = '';
          promptInput.style.height = 'auto';
        }
        if (slashMenu) slashMenu.classList.add('hidden');
        if (newChatBtn) newChatBtn.click();
        if (navigator.vibrate) navigator.vibrate([20, 20]);
        return;
      }

      if (promptInput) {
        promptInput.value = cmd;
        promptInput.focus();
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
        if (typeof updateSendButtonMode === 'function') updateSendButtonMode();
      }
      if (slashMenu) slashMenu.classList.add('hidden');
    });
  });



  // ➕ Initialize Unified Attachment Menu
  initAttachMenu();

  // Initialize GPS Chip
  if (typeof initGpsHandler === 'function') {
    initGpsHandler();
  }

  // 📋 Initialize Clipboard Smart Sensors
  if (typeof initClipboardSmartSensors === 'function') {
    initClipboardSmartSensors();
  }

  // 🔍 History Conversation Search Listeners
  const convSearchInput = document.getElementById('conv-search-input');
  const convSearchClear = document.getElementById('conv-search-clear');

  if (convSearchInput) {
    convSearchInput.addEventListener('input', (e) => {
      if (typeof renderConversationItems === 'function' && typeof cachedConversations !== 'undefined') {
        renderConversationItems(cachedConversations, e.target.value);
      }
    });
  }

  if (convSearchClear) {
    convSearchClear.addEventListener('click', () => {
      if (typeof window.haptic === 'function') window.haptic('light');
      if (convSearchInput) {
        convSearchInput.value = '';
        convSearchInput.focus();
      }
      if (typeof renderConversationItems === 'function' && typeof cachedConversations !== 'undefined') {
        renderConversationItems(cachedConversations, '');
      }
    });
  }

  // New Chat Action
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      // 🛡️ Abort any running stream when creating new chat
      if (currentAbortController) {
        try { currentAbortController.abort(); } catch(e) {}
        currentAbortController = null;
      }
      if (typeof clearQueuedBtwMessages === 'function') clearQueuedBtwMessages();
      currentConversationId = null;
      localStorage.removeItem(activeConversationStorageKey());
      revokeAllBlobUrls();
      if (typeof setStreamingState === 'function') setStreamingState(false);
      if (promptInput) {
        promptInput.value = '';
        promptInput.style.height = 'auto';
      }
      uploadedImagePath = null;
      if (cameraInput) cameraInput.value = '';
      if (attachInput) attachInput.value = '';
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
      if (headerTitle) headerTitle.textContent = '新對話';
      if (messagesContainer) messagesContainer.innerHTML = '';
      appendMessage('assistant', '你好！已為你開啟新對話。有什麼可以幫你的？');
      toggleDrawer(false);

      // 🔥 Pre-warm standby resident process in background
      if (typeof window.requestProviderPrewarm === 'function') window.requestProviderPrewarm();
    });
  }

  // ✏️ Header Title Rename Listeners
  const headerRenameBtn = document.getElementById('header-rename-btn');
  const triggerHeaderRename = () => {
    if (currentConversationId && typeof renameConversationDirect === 'function') {
      renameConversationDirect(currentConversationId, headerTitle ? headerTitle.textContent : '');
    } else {
      alert('請先發送訊息建立對話後，即可自定義對話標題！');
    }
  };

  if (headerRenameBtn) headerRenameBtn.addEventListener('click', triggerHeaderRename);
  if (headerTitle) headerTitle.addEventListener('click', triggerHeaderRename);

  // Camera & Image Upload Handlers (with HEIC support & AI-vision compression)
  async function processAndUploadImageBase64(base64Data, filename) {
    try {
      if (previewFilename) previewFilename.textContent = filename || 'photo.jpg';
      if (previewFilesize) previewFilesize.textContent = '處理上傳中...';
      if (imagePreviewContainer) imagePreviewContainer.classList.remove('hidden');

      const kb = Math.round((base64Data.length * 3 / 4) / 1024);
      if (previewThumb) previewThumb.src = base64Data;
      if (previewFilesize) previewFilesize.textContent = `已最佳化壓縮 (${kb} KB)`;

      console.log(`[Upload] Sending base64 (${kb} KB) to /api/upload...`);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data, filename: filename || 'photo.jpg' })
      });
      const data = await res.json();
      if (data.success) {
        uploadedImagePath = data.filePath;
        console.log('[Upload] Success! Server file path:', uploadedImagePath);
        if (navigator.vibrate) navigator.vibrate(25);
      } else {
        alert('圖片上傳失敗：' + (data.error || '未知錯誤'));
      }
    } catch (err) {
      console.error('[Upload Error]', err);
      alert('圖片處理失敗：' + err.message);
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    }
  }

  async function handleImageSelection(file) {
    if (!file) return;
    console.log('[ImageSelection] File received:', file.name, file.size, file.type);
    try {
      if (previewFilename) previewFilename.textContent = file.name || 'photo.jpg';
      if (previewFilesize) previewFilesize.textContent = '最佳化壓縮中...';
      if (imagePreviewContainer) imagePreviewContainer.classList.remove('hidden');

      const { base64, kb } = await compressImageFile(file, 1280, 0.82);
      console.log('[ImageSelection] Compressed:', kb, 'KB');
      await processAndUploadImageBase64(base64, file.name || 'photo.jpg');
    } catch (err) {
      console.error('[Image Selection Error]', err);
      alert('圖片處理失敗：' + err.message);
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    }
  }

  window.processAndUploadImageBase64 = processAndUploadImageBase64;
  window.handleImageSelection = handleImageSelection;

  // 📋 Direct Image Paste Support (e.g. pasted screenshots or copied photos from gallery/web)
  window.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.items) {
      for (const item of e.clipboardData.items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleImageSelection(file);
            break;
          }
        }
      }
    }
  });

  // 📂 Direct Image Drag & Drop Support
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        handleImageSelection(file);
      }
    }
  });

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
      uploadedImagePath = null;
      if (cameraInput) cameraInput.value = '';
      if (attachInput) attachInput.value = '';
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    });
  }

  // ➕ Unified Attachment Menu Controller
  function initAttachMenu() {
    const attachMenuBtn = document.getElementById('attach-menu-btn');
    const attachMenuDropdown = document.getElementById('attach-menu-dropdown');
    const attachInput = document.getElementById('attach-input');
    const cameraInput = document.getElementById('camera-input');
    const attachOptCamera = document.getElementById('attach-opt-camera');
    const attachOptGallery = document.getElementById('attach-opt-gallery');
    const attachOptFiles = document.getElementById('attach-opt-files');
    const attachOptGps = document.getElementById('attach-opt-gps');
    const attachOptDiscussion = document.getElementById('attach-opt-discussion');

    if (attachMenuBtn && attachMenuDropdown) {
      attachMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.haptic === 'function') window.haptic('light');
        attachMenuDropdown.classList.toggle('hidden');
      });

      document.addEventListener('click', (e) => {
        if (!attachMenuDropdown.contains(e.target) && !attachMenuBtn.contains(e.target)) {
          attachMenuDropdown.classList.add('hidden');
        }
      });

      if (attachOptCamera && cameraInput) {
        attachOptCamera.addEventListener('click', () => {
          if (typeof window.haptic === 'function') window.haptic('light');
          attachMenuDropdown.classList.add('hidden');
          cameraInput.click();
        });
      }

      if (attachOptGallery && attachInput) {
        attachOptGallery.addEventListener('click', () => {
          if (typeof window.haptic === 'function') window.haptic('light');
          attachMenuDropdown.classList.add('hidden');
          attachInput.click();
        });
      }

      if (attachOptFiles) {
        attachOptFiles.addEventListener('click', () => {
          if (typeof window.haptic === 'function') window.haptic('light');
          attachMenuDropdown.classList.add('hidden');
          if (typeof toggleFilesModal === 'function') toggleFilesModal(true);
        });
      }

      if (attachOptGps) {
        attachOptGps.addEventListener('click', () => {
          if (typeof window.haptic === 'function') window.haptic('light');
          attachMenuDropdown.classList.add('hidden');
          if (typeof triggerGpsLocation === 'function') {
            triggerGpsLocation();
          }
        });
      }

      if (attachOptDiscussion) {
        attachOptDiscussion.addEventListener('click', () => {
          if (typeof window.haptic === 'function') window.haptic('light');
          attachMenuDropdown.classList.add('hidden');
          if (typeof window.startDiscussionLive === 'function') window.startDiscussionLive();
        });
      }
    }
  }



  // Send Button Listener
  if (sendBtn) {
    sendBtn.addEventListener('click', handleSendClick);
  }

  // Initialize providers and models, then restore the active conversation.
  (async function initProviderState() {
    try {
      await loadProviderCatalog();
      const modelsData = await loadModelsCatalog();
      const providerModels = availableModels.filter(model => (model.provider || 'antigravity') === currentProvider);
      currentModel = localStorage.getItem(providerStorageKey('current_model')) || (providerModels.find(model => model.isDefault) || providerModels[0] || {}).id || 'gemini-3.7-flash';
      const selectedModel = providerModels.find(model => model.id === currentModel);
      const supported = selectedModel?.supportedReasoningEfforts || ['low', 'medium', 'high'];
      currentEffort = localStorage.getItem(providerStorageKey('current_effort')) || selectedModel?.defaultReasoningEffort || 'low';
      if (!supported.includes(currentEffort)) currentEffort = selectedModel?.defaultReasoningEffort || supported[0] || 'low';
      if (modelsData.efforts) availableEfforts = modelsData.efforts;
      updateModelUI();
      updateEffortUI();
      const savedConvId = localStorage.getItem(activeConversationStorageKey());
      const res = await fetch(`/api/conversations?${providerQuery()}`);
      const data = await res.json();
      if (data.conversations && data.conversations.length > 0) {
        const targetId = (savedConvId && data.conversations.some(c => c.id === savedConvId))
          ? savedConvId
          : data.conversations[0].id;
        loadConversationHistory(targetId);
      }
    } catch (e) {
      console.error('Init load error:', e);
      updateModelUI();
      updateEffortUI();
    }
  })();

  // 🌐 Unified real-time intake from CrewHelper and Browser Extension.
  const inboundQueue = [];
  const handledInboundIds = new Set();
  const handledInboundOrder = [];
  let inboundQueueRunning = false;

  const rememberInboundId = (id) => {
    if (!id || handledInboundIds.has(id)) return false;
    handledInboundIds.add(id);
    handledInboundOrder.push(id);
    if (handledInboundOrder.length > 100) {
      handledInboundIds.delete(handledInboundOrder.shift());
    }
    return true;
  };

  const waitForMainStreamIdle = () => {
    if (!isStreaming) return Promise.resolve();
    return new Promise(resolve => {
      const onState = (event) => {
        if (event.detail?.streaming !== false) return;
        window.removeEventListener('crew:streaming-state', onState);
        resolve();
      };
      window.addEventListener('crew:streaming-state', onState);
    });
  };

  const formatInboundPrompt = (msg) => {
    let prefix = '[External] ';
    if (msg.source === 'FloatingBubble') prefix = '[Bubble] ';
    else if (msg.source === 'CrewHelper') prefix = '[Helper] ';
    else if (msg.source === 'BrowserExtension') prefix = '[Web] ';
    const sourceInfo = msg.url ? `\nURL: ${msg.url}` : '';
    return `${prefix}${msg.text}${sourceInfo}`;
  };

  const processInboundQueue = async () => {
    if (inboundQueueRunning) return;
    inboundQueueRunning = true;
    try {
      while (inboundQueue.length > 0) {
        await waitForMainStreamIdle();
        const msg = inboundQueue.shift();
        if (!msg) continue;
        if (typeof window.sendMessage !== 'function') {
          inboundQueue.unshift(msg);
          break;
        }
        await window.sendMessage({
          text: formatInboundPrompt(msg),
          imagePath: msg.image_path || null
        });
      }
    } finally {
      inboundQueueRunning = false;
    }
  };

  const enqueueInboundForChat = (msg) => {
    if (!msg || !msg.text || !rememberInboundId(msg.id)) return;
    inboundQueue.push(msg);
    processInboundQueue();
  };

  const inboundEvents = new EventSource('/api/inbound/events');
  inboundEvents.addEventListener('inbound-message', (event) => {
    try {
      enqueueInboundForChat(JSON.parse(event.data));
    } catch (e) {
      console.warn('Inbound message parse failed', e);
    }
  });
  inboundEvents.addEventListener('error', () => {
    console.warn('Inbound event stream disconnected; browser will reconnect automatically.');
  });

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAppAndListeners);
} else {
  initAppAndListeners();
}
