package com.crewpocket.helper;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Receives the single quick-message action from the Helper status notification. */
public class CrewNotificationReceiver extends BroadcastReceiver {
    public static final String ACTION_INPUT = "com.crewpocket.helper.NOTIFICATION_INPUT";
    public static final String EXTRA_INPUT = "crew_command";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_INPUT.equals(intent.getAction())) return;
        android.os.Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence command = results == null ? null : results.getCharSequence(EXTRA_INPUT);
        if (command != null && command.toString().trim().length() > 0) {
            FloatingBubbleManager.getInstance(context).sendNotificationMessage(command.toString().trim());
        }
    }
}
