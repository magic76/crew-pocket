import re

# 1. Update CrewAccessibilityService.java
with open('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/CrewAccessibilityService.java', 'r') as f:
    cas = f.read()

cas = cas.replace('GLOBAL_ACTION_TAKE_SCREENSHOT', '9')
if 'public static boolean isServiceRunning()' not in cas:
    cas = cas.replace('public static CrewAccessibilityService getInstance() {', 
                      'public static boolean isServiceRunning() { return instance != null; }\n    public static CrewAccessibilityService getInstance() {')

with open('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/CrewAccessibilityService.java', 'w') as f:
    f.write(cas)

# 2. Update FloatingBubbleManager.java
with open('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/FloatingBubbleManager.java', 'r') as f:
    fbm = f.read()

# Replace TYPE_APPLICATION_OVERLAY with 2038
fbm = fbm.replace('WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY', '2038')
# Replace VERSION_CODES.O with 26
fbm = fbm.replace('Build.VERSION_CODES.O', '26')
# Replace VibrationEffect
fbm = fbm.replace('import android.os.VibrationEffect;', '')
fbm = re.sub(r'if \(Build\.VERSION\.SDK_INT >= 26\) \{[^}]*\} else \{([^}]*)\}', r'\1', fbm)
fbm = fbm.replace('vibrator.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE));', 'vibrator.vibrate(35);')
fbm = fbm.replace('vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));', 'vibrator.vibrate(timings, -1);')

# Ensure hideBubble exists
if 'public void hideBubble()' not in fbm:
    fbm = fbm.replace('public void showBubble() {', 'public void hideBubble() { if (bubbleView != null) { try { windowManager.removeView(bubbleView); } catch(Exception e){} bubbleView = null; } }\n    public void showBubble() {')

with open('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/FloatingBubbleManager.java', 'w') as f:
    f.write(fbm)

# Remove duplicate R.java in src
import os
if os.path.exists('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/R.java'):
    os.remove('/data/data/com.termux/files/home/crew-helper-app/src/com/crewpocket/helper/R.java')

print("SUCCESS: Fixed Java sources for API 24 compatibility!")
