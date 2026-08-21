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

  // New Chat Action
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
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
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
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

  // 🎙️ Walkie-Talkie Push-to-Talk (PTT) & Web Speech Recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && micBtn) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'zh-TW';

    let isPttMode = false;
    let pttStartTime = 0;
    let capturedTranscript = '';

    recognition.onstart = () => {
      isRecording = true;
      capturedTranscript = '';
      if (typeof streamingTTS !== 'undefined') streamingTTS.stop();
      if (isPttMode) {
        micBtn.classList.add('walkie-talkie-active');
        if (promptInput) promptInput.placeholder = '🎙️ 正在對講錄音中...（放開立即發送）';
      } else {
        micBtn.classList.add('bg-rose-600', 'text-white', 'recording-pulse');
      }
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript.trim()) {
        capturedTranscript = transcript;
        if (promptInput) {
          promptInput.value = transcript;
          promptInput.dispatchEvent(new Event('input'));
        }
      }
    };

    recognition.onerror = (e) => {
      console.error('Speech recognition error:', e);
      isRecording = false;
      micBtn.classList.remove('bg-rose-600', 'text-white', 'recording-pulse', 'walkie-talkie-active');
      if (promptInput) promptInput.placeholder = '輸入訊息，或輸入 / 選擇指令...';
    };

    recognition.onend = () => {
      isRecording = false;
      const wasPtt = isPttMode;
      isPttMode = false;
      micBtn.classList.remove('bg-rose-600', 'text-white', 'recording-pulse', 'walkie-talkie-active');
      if (promptInput) promptInput.placeholder = '輸入訊息，或輸入 / 選擇指令...';

      if (wasPtt) {
        // Auto-send with Voice mode for sub-second streaming speech output!
        const text = (capturedTranscript || (promptInput ? promptInput.value : '')).trim();
        if (text) {
          if (promptInput) promptInput.value = text;
          if (typeof sendMessage === 'function') {
            sendMessage(true); // isVoice = true
          }
        }
      }
    };

    // --- Walkie-Talkie Push-to-Talk (PTT) Event Listeners ---
    const startPtt = (e) => {
      if (isStreaming && typeof stopGeneration === 'function') {
        stopGeneration();
      }
      if (typeof streamingTTS !== 'undefined') {
        streamingTTS.stop();
      }
      isPttMode = true;
      pttStartTime = Date.now();
      if (navigator.vibrate) navigator.vibrate(30);
      try {
        recognition.start();
      } catch (err) {}
    };

    const stopPtt = (e) => {
      if (!isPttMode) return;
      const duration = Date.now() - pttStartTime;
      if (navigator.vibrate) navigator.vibrate([15, 20]);

      // If held for more than 320ms, it's a push-to-talk action: stop and auto-send!
      if (duration > 320) {
        try {
          recognition.stop();
        } catch (err) {}
      } else {
        // Short tap: cancel PTT auto-send mode, keep regular recording active
        isPttMode = false;
        micBtn.classList.remove('walkie-talkie-active');
        micBtn.classList.add('bg-rose-600', 'text-white', 'recording-pulse');
      }
    };

    // Touch events for mobile
    micBtn.addEventListener('touchstart', (e) => {
      startPtt(e);
    }, { passive: true });

    micBtn.addEventListener('touchend', (e) => {
      stopPtt(e);
    }, { passive: true });

    // Mouse events for desktop
    micBtn.addEventListener('mousedown', (e) => {
      startPtt(e);
    });

    micBtn.addEventListener('mouseup', (e) => {
      stopPtt(e);
    });

    // Fallback click listener for single tap toggle
    micBtn.addEventListener('click', (e) => {
      if (isRecording && !isPttMode) {
        recognition.stop();
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
