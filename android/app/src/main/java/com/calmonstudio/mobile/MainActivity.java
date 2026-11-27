package com.calmonstudio.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static String pendingSharedText = null;
    public static String pendingSharedUri = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CalmonNativePlugin.class);
        super.onCreate(savedInstanceState);
        captureShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        captureShareIntent(intent);
    }

    private void captureShareIntent(Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null && !text.isEmpty()) {
                pendingSharedText = text;
            }
            Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (streamUri != null) {
                pendingSharedUri = streamUri.toString();
            }
        }
    }
}
