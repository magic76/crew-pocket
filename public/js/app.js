// Antigravity Web UI - Main Application Entrypoint & Bootstrap

// 1. Marked.js configuration (Table Responsive Wrapper)
if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  const originalTable = renderer.table.bind(renderer);
  renderer.table = function(header, body) {
    const tableHtml = originalTable(header, body);
    return `<div class="table-wrapper">${tableHtml}</div>`;
  };
  marked.setOptions({ renderer: renderer });
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
  // Drawer listeners
  if (menuBtn) menuBtn.addEventListener('click', () => toggleDrawer(true));
  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', () => toggleDrawer(false));
  if (drawerOverlay) drawerOverlay.addEventListener('click', () => toggleDrawer(false));

  // Lightbox listeners
  if (closeLightboxBtn) closeLightboxBtn.addEventListener('click', () => lightbox.classList.add('opacity-0', 'pointer-events-none'));
  if (lightbox) lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.classList.add('opacity-0', 'pointer-events-none'); });

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

  // Model Selector listeners
  if (modelSelectorBtn) modelSelectorBtn.addEventListener('click', () => toggleModelModal(true));
  if (closeModelBtn) closeModelBtn.addEventListener('click', () => toggleModelModal(false));
  if (modelModal) modelModal.addEventListener('click', (e) => { if (e.target === modelModal) toggleModelModal(false); });

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

  // Scroll tracker
  if (messagesContainer) {
    messagesContainer.addEventListener('scroll', () => {
      const threshold = 80;
      const isAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight <= threshold;
      userScrolledUp = !isAtBottom;
    });
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
      const cmd = btn.dataset.cmd;
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

  // New Chat Action
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      currentConversationId = null;
      localStorage.removeItem('agy_active_conv_id');
      revokeAllBlobUrls();
      if (headerTitle) headerTitle.textContent = '新對話';
      if (messagesContainer) messagesContainer.innerHTML = '';
      appendMessage('assistant', '你好！已為你開啟新對話。有什麼可以幫你的？');
      toggleDrawer(false);
    });
  }

  // Camera & Image Upload
  if (camBtn && cameraInput) {
    camBtn.addEventListener('click', () => cameraInput.click());
    cameraInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        if (previewFilename) previewFilename.textContent = '壓縮中...';
        if (imagePreviewContainer) imagePreviewContainer.classList.remove('hidden');

        const { base64, kb } = await compressImageFile(file, 1280, 0.8);
        if (previewThumb) previewThumb.src = base64;
        if (previewFilename) previewFilename.textContent = file.name || 'photo.jpg';
        if (previewFilesize) previewFilesize.textContent = `已優化至 ${kb} KB`;

        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, filename: 'photo.jpg' })
        });
        const data = await res.json();
        if (data.success) {
          uploadedImagePath = data.filePath;
        }
      } catch (err) {
        alert('圖片處理失敗：' + err.message);
        if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
      }
    });
  }

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
      uploadedImagePath = null;
      if (cameraInput) cameraInput.value = '';
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    });
  }

  // Web Speech Recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && micBtn) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'zh-TW';

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add('bg-rose-600', 'text-white', 'recording-pulse');
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (promptInput) {
        promptInput.value = transcript;
        promptInput.dispatchEvent(new Event('input'));
      }
    };

    recognition.onerror = (e) => {
      console.error('Speech recognition error:', e);
      isRecording = false;
      micBtn.classList.remove('bg-rose-600', 'text-white', 'recording-pulse');
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('bg-rose-600', 'text-white', 'recording-pulse');
    };

    micBtn.addEventListener('click', () => {
      if (isRecording) {
        recognition.stop();
      } else {
        recognition.start();
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

  // Initialize available models list
  fetch('/api/models').then(r => r.json()).then(data => {
    availableModels = data.models || [];
    updateModelUI();
  }).catch(() => {});

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
