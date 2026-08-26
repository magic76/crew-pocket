package com.crewpocket.helper;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles the small set of actions exposed by the persistent Crew Helper notification. */
public class CrewNotificationReceiver extends BroadcastReceiver {
    public static final String ACTION_INPUT = "com.crewpocket.helper.NOTIFICATION_INPUT";
    public static final String ACTION_OPEN_INPUT = "com.crewpocket.helper.NOTIFICATION_OPEN_INPUT";
    public static final String ACTION_STOP = "com.crewpocket.helper.NOTIFICATION_STOP";
    public static final String EXTRA_INPUT = "crew_command";

    @Override
    public void onReceive(Context context, Intent intent) {
        FloatingBubbleManager manager = FloatingBubbleManager.getInstance(context);
        String action = intent == null ? "" : intent.getAction();
        if (ACTION_OPEN_INPUT.equals(action)) {
            manager.openInputUi();
            return;
        }
        if (ACTION_STOP.equals(action)) {
            manager.stopCrewPocketGeneration();
            manager.updateNotification("已停止");
            return;
        }
        if (ACTION_INPUT.equals(action)) {
            android.os.Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence command = results == null ? null : results.getCharSequence(EXTRA_INPUT);
            if (command != null && command.toString().trim().length() > 0) {
                manager.sendNotificationMessage(command.toString().trim());
            } else {
                manager.updateNotification("未輸入指令");
            }
        }
    }
}
