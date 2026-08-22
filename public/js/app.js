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
  navigator.serviceWorker.register('/sw.js').then(reg => {
    swRegistration = reg;
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

async function checkInternetConnection() {
  if (!navigator.onLine) {
    updateNetworkUI(false);
    return false;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    await fetch('https://www.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    clearTimeout(timeoutId);
    updateNetworkUI(true);
    return true;
  } catch (e) {
    updateNetworkUI(navigator.onLine);
    return navigator.onLine;
  }
}

window.addEventListener('online', () => {
  updateNetworkUI(true);
  checkInternetConnection();
  if (navigator.vibrate) navigator.vibrate(20);
});

window.addEventListener('offline', () => {
  updateNetworkUI(false);
  if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkInternetConnection();
});

setInterval(checkInternetConnection, 30000);
checkInternetConnection();

// 4. Bind Global UI Listeners
document.addEventListener('DOMContentLoaded', () => {
  // 🚀 Holographic Quantum Splash Screen Dismissal (Option 1)
  const splashScreen = document.getElementById('app-splash-screen');
  if (splashScreen) {
    if (navigator.vibrate) {
      try { navigator.vibrate([20, 30]); } catch (e) {}
    }
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
      toolsMenuDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!toolsMenuDropdown.contains(e.target) && !toolsMenuBtn.contains(e.target)) {
        toolsMenuDropdown.classList.add('hidden');
      }
    });

    [filesBtn, usageBtn, cheatSheetBtn, notifyBtn].forEach(btn => {
      if (btn) btn.addEventListener('click', () => toolsMenuDropdown.classList.add('hidden'));
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

  // Model & Effort Selector listeners
  if (modelSelectorBtn) modelSelectorBtn.addEventListener('click', () => toggleModelModal(true));
  if (effortSelectorBtn) effortSelectorBtn.addEventListener('click', () => toggleModelModal(true));
  if (closeModelBtn) closeModelBtn.addEventListener('click', () => toggleModelModal(false));
  if (modelModal) modelModal.addEventListener('click', (e) => { if (e.target === modelModal) toggleModelModal(false); });

  // Files Explorer Modal listeners
  if (filesBtn) filesBtn.addEventListener('click', () => toggleFilesModal(true));
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
        sendMessage();
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
      }
      if (slashMenu) slashMenu.classList.add('hidden');
    });
  });

  // Quick Action Chips Fill Handler
  document.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const fillText = chip.getAttribute('data-fill');
      if (!fillText || !promptInput) return;
      promptInput.value = fillText;
      promptInput.focus();
      promptInput.dispatchEvent(new Event('input'));
      if (navigator.vibrate) navigator.vibrate(20);
    });
  });

  // Initialize GPS Chip
  if (typeof initGpsHandler === 'function') {
    initGpsHandler();
  }

  // 📋 Initialize Clipboard Smart Sensors
  if (typeof initClipboardSmartSensors === 'function') {
    initClipboardSmartSensors();
  }

  // New Chat Action
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      // 🛡️ Abort any running stream when creating new chat
      if (currentAbortController) {
        try { currentAbortController.abort(); } catch(e) {}
        currentAbortController = null;
      }
      currentConversationId = null;
      localStorage.removeItem('agy_active_conv_id');
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
      fetch('/api/prewarm', { method: 'POST' }).catch(() => {});
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

  // Camera & Image Upload Handlers (with Interactive Cropping & HEIC support & AI-vision compression)
  let currentSelectedImageSource = null;
  const cropImageBtn = document.getElementById('crop-image-btn');

  async function processAndUploadImageBase64(base64Data, filename, wasCropped) {
    try {
      if (previewFilename) previewFilename.textContent = filename || 'photo.jpg';
      if (previewFilesize) previewFilesize.textContent = '處理上傳中...';
      if (imagePreviewContainer) imagePreviewContainer.classList.remove('hidden');

      const kb = Math.round((base64Data.length * 3 / 4) / 1024);
      if (previewThumb) previewThumb.src = base64Data;
      if (previewFilesize) {
        previewFilesize.textContent = wasCropped ? `已框選裁切 (${kb} KB)` : `已最佳化壓縮 (${kb} KB)`;
      }

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data, filename: filename || 'photo.jpg' })
      });
      const data = await res.json();
      if (data.success) {
        uploadedImagePath = data.filePath;
        if (navigator.vibrate) navigator.vibrate(25);
      } else {
        alert('圖片上傳失敗：' + (data.error || '未知錯誤'));
      }
    } catch (err) {
      alert('圖片處理失敗：' + err.message);
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    }
  }

  async function handleImageSelection(file) {
    if (!file) return;
    currentSelectedImageSource = file;
    if (typeof openImageCropper === 'function') {
      openImageCropper(file, (finalBase64, wasCropped) => {
        processAndUploadImageBase64(finalBase64, file.name, wasCropped);
      });
    } else {
      try {
        const { base64 } = await compressImageFile(file, 1280, 0.8);
        processAndUploadImageBase64(base64, file.name, false);
      } catch(err) {
        alert('圖片壓縮失敗：' + err.message);
      }
    }
  }

  if (cropImageBtn) {
    cropImageBtn.addEventListener('click', () => {
      if (currentSelectedImageSource && typeof openImageCropper === 'function') {
        openImageCropper(currentSelectedImageSource, (finalBase64, wasCropped) => {
          processAndUploadImageBase64(finalBase64, currentSelectedImageSource.name || 'photo.jpg', wasCropped);
        });
      }
    });
  }

  if (camBtn && cameraInput) {
    camBtn.addEventListener('click', () => {
      cameraInput.value = '';
      cameraInput.click();
    });
    cameraInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImageSelection(e.target.files[0]);
      }
    });
  }

  if (attachBtn && attachInput) {
    attachBtn.addEventListener('click', () => {
      attachInput.value = '';
      attachInput.click();
    });
    attachInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImageSelection(e.target.files[0]);
      }
    });
  }

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
      currentSelectedImageSource = null;
      if (cameraInput) cameraInput.value = '';
      if (attachInput) attachInput.value = '';
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    });
  }

  // Web Speech Recognition (Click to toggle voice transcription)
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && micBtn) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'zh-TW';

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add('bg-rose-600', 'text-white', 'recording-pulse');
      if (promptInput) promptInput.placeholder = '🎙️ 正在聆聽語音...';
      if (navigator.vibrate) navigator.vibrate(20);
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (promptInput && transcript.trim()) {
        promptInput.value = transcript;
        promptInput.dispatchEvent(new Event('input'));
      }
    };

    recognition.onerror = (e) => {
      console.error('Speech recognition error:', e);
      isRecording = false;
      micBtn.classList.remove('bg-rose-600', 'text-white', 'recording-pulse');
      if (promptInput) promptInput.placeholder = '問任何問題... (Ctrl+Enter 發送)';
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('bg-rose-600', 'text-white', 'recording-pulse');
      if (promptInput) promptInput.placeholder = '問任何問題... (Ctrl+Enter 發送)';
      if (navigator.vibrate) navigator.vibrate([15, 15]);
    };

    micBtn.addEventListener('click', () => {
      if (isRecording) {
        recognition.stop();
      } else {
        try {
          recognition.start();
        } catch (e) {}
      }
    });

  } else if (micBtn) {
    micBtn.classList.add('opacity-40');
    micBtn.title = '此瀏覽器不支援語音辨識';
  }

  // Send Button Listener
  if (sendBtn) {
    sendBtn.addEventListener('click', handleSendClick);
  }

  // Initialize available models & thinking efforts list
  fetch('/api/models').then(r => r.json()).then(data => {
    availableModels = data.models || [];
    if (data.efforts) availableEfforts = data.efforts;
    updateModelUI();
    updateEffortUI();
  }).catch(() => {
    updateModelUI();
    updateEffortUI();
  });

  // Initial load: Restore last active conversation or load most recent
  (async function initApp() {
    try {
      const savedConvId = localStorage.getItem('agy_active_conv_id');
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (data.conversations && data.conversations.length > 0) {
        const targetId = (savedConvId && data.conversations.some(c => c.id === savedConvId))
          ? savedConvId
          : data.conversations[0].id;
        loadConversationHistory(targetId);
      }
    } catch (e) {
      console.error('Init load error:', e);
    }
  })();
});
