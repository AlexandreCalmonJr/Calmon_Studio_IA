package com.calmonstudio.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class CalmonRemoteWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            Intent intent = new Intent(context, MainActivity.class);
            intent.putExtra("open_tab", "remote");
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.calmon_widget);
            views.setOnClickPendingIntent(R.id.calmon_widget_btn, pendingIntent);
            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }
}

