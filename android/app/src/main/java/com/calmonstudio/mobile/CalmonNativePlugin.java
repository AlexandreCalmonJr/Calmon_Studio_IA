package com.calmonstudio.mobile;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "CalmonNative")
public class CalmonNativePlugin extends Plugin {

    static {
        System.loadLibrary("calmon_native_llm");
    }

    private native String nativeInspectGguf(String modelPath, String prompt);

    private static final int DISCOVERY_PORT = 41234;

    @PluginMethod
    public void discoverLanHosts(PluginCall call) {
        new Thread(() -> {
            JSArray hosts = new JSArray();
            Set<String> seen = new HashSet<>();
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setBroadcast(true);
                socket.setSoTimeout(1200);
                byte[] probe = "CALMON_DISCOVER".getBytes(StandardCharsets.UTF_8);
                DatagramPacket packet = new DatagramPacket(
                    probe,
                    probe.length,
                    InetAddress.getByName("255.255.255.255"),
                    DISCOVERY_PORT
                );
                socket.send(packet);

                long deadline = System.currentTimeMillis() + 1400;
                byte[] buf = new byte[1024];
                while (System.currentTimeMillis() < deadline) {
                    try {
                        DatagramPacket reply = new DatagramPacket(buf, buf.length);
                        socket.receive(reply);
                        String ip = reply.getAddress().getHostAddress();
                        if (seen.contains(ip)) continue;
                        seen.add(ip);
                        String raw = new String(reply.getData(), 0, reply.getLength(), StandardCharsets.UTF_8);
                        JSONObject json = new JSONObject(raw);
                        if ("calmon-studio".equals(json.optString("service"))) {
                            JSObject item = new JSObject();
                            item.put("ip", ip);
                            item.put("hostname", json.optString("hostname", ip));
                            item.put("port", json.optInt("port", 3000));
                            item.put("platform", json.optString("platform", "win32"));
                            item.put("url", "http://" + ip + ":" + json.optInt("port", 3000));
                            hosts.put(item);
                        }
                    } catch (SocketTimeoutException ignored) {
                        break;
                    } catch (Exception ignored) {
                        // ignore malformed packet
                    }
                }
            } catch (Exception e) {
                call.reject("Falha na descoberta UDP LAN: " + e.getMessage());
                return;
            }
            JSObject res = new JSObject();
            res.put("hosts", hosts);
            call.resolve(res);
        }).start();
    }

    @PluginMethod
    public void startForegroundBridge(PluginCall call) {
        String host = call.getString("host", "");
        Context ctx = getContext();
        Intent intent = new Intent(ctx, CalmonBridgeService.class);
        intent.putExtra("host", host);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
        JSObject res = new JSObject();
        res.put("running", true);
        call.resolve(res);
    }

    @PluginMethod
    public void stopForegroundBridge(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, CalmonBridgeService.class));
        JSObject res = new JSObject();
        res.put("running", false);
        call.resolve(res);
    }

    @PluginMethod
    public void authenticateBiometric(PluginCall call) {
        KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        if (km == null || !km.isDeviceSecure()) {
            JSObject res = new JSObject();
            res.put("authenticated", true);
            res.put("method", "device_unsecured_fallback");
            call.resolve(res);
            return;
        }
        Intent confirmIntent = km.createConfirmDeviceCredentialIntent(
            "Aprovação Administrativa · Calmon Studio",
            call.getString("reason", "Confirme sua identidade para autorizar esta ação no PC.")
        );
        if (confirmIntent == null) {
            call.reject("Autenticação do dispositivo indisponível.");
            return;
        }
        startActivityForResult(call, confirmIntent, "handleDeviceCredentialResult");
    }

    @ActivityCallback
    private void handleDeviceCredentialResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK) {
            JSObject res = new JSObject();
            res.put("authenticated", true);
            res.put("method", "android_credential");
            call.resolve(res);
        } else {
            call.reject("Autenticação cancelada pelo usuário.");
        }
    }

    @PluginMethod
    public void listLocalModels(PluginCall call) {
        File dir = new File(getContext().getFilesDir(), "models");
        JSArray list = new JSArray();
        if (dir.exists() && dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (f.isFile() && f.getName().endsWith(".gguf")) {
                        JSObject item = new JSObject();
                        item.put("id", f.getName().replace(".gguf", ""));
                        item.put("filename", f.getName());
                        item.put("sizeBytes", f.length());
                        list.put(item);
                    }
                }
            }
        }
        JSObject res = new JSObject();
        res.put("models", list);
        call.resolve(res);
    }

    @PluginMethod
    public void downloadLocalModel(PluginCall call) {
        String modelId = call.getString("modelId", "");
        String downloadUrl = call.getString("url", "");
        if (modelId.isEmpty() || downloadUrl.isEmpty()) {
            call.reject("modelId e url são obrigatórios.");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "models");
                if (!dir.exists()) dir.mkdirs();
                File target = new File(dir, modelId.replaceAll("[^a-zA-Z0-9._-]", "_") + ".gguf");
                URL url = new URL(downloadUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.connect();
                if (conn.getResponseCode() >= 400) {
                    call.reject("HTTP " + conn.getResponseCode() + " ao baixar modelo.");
                    return;
                }
                long totalBytes = 0;
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(target)) {
                    byte[] buffer = new byte[16384];
                    int len;
                    while ((len = in.read(buffer)) != -1) {
                        out.write(buffer, 0, len);
                        totalBytes += len;
                    }
                }
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("path", target.getAbsolutePath());
                res.put("sizeBytes", totalBytes);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Erro ao baixar modelo GGUF: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void checkAppUpdate(PluginCall call) {
        String repo = call.getString("repo", "AlexandreCalmonJr/Frontend_JarvisHub");
        new Thread(() -> {
            try {
                PackageInfo pInfo = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
                String currentVersion = pInfo.versionName != null ? pInfo.versionName : "3.1.0";
                URL url = new URL("https://api.github.com/repos/" + repo + "/releases/latest");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestProperty("Accept", "application/vnd.github+json");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                if (conn.getResponseCode() >= 400) {
                    call.reject("HTTP " + conn.getResponseCode() + " ao verificar atualizações.");
                    return;
                }
                StringBuilder sb = new StringBuilder();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                    }
                }
                JSONObject release = new JSONObject(sb.toString());
                String tag = release.optString("tag_name", "").replaceFirst("^v", "");
                String apkUrl = "";
                JSONArray assets = release.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject a = assets.getJSONObject(i);
                        String name = a.optString("name", "");
                        if (name.endsWith(".apk")) {
                            apkUrl = a.optString("browser_download_url", "");
                            break;
                        }
                    }
                }
                boolean hasUpdate = !tag.isEmpty() && !tag.equals(currentVersion) && !apkUrl.isEmpty();
                JSObject res = new JSObject();
                res.put("currentVersion", currentVersion);
                res.put("latestVersion", tag);
                res.put("hasUpdate", hasUpdate);
                res.put("apkUrl", apkUrl);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Erro ao checar atualização: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String apkUrl = call.getString("apkUrl", "");
        if (apkUrl.isEmpty()) {
            call.reject("apkUrl é obrigatório.");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists()) dir.mkdirs();
                File apkFile = new File(dir, "calmon-studio-update.apk");
                URL url = new URL(apkUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                if (conn.getResponseCode() >= 400) {
                    call.reject("HTTP " + conn.getResponseCode() + " ao baixar APK.");
                    return;
                }
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apkFile)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                }
                Uri contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apkFile
                );
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(installIntent);
                JSObject res = new JSObject();
                res.put("started", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Erro ao baixar/instalar APK: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void ringPhone(PluginCall call) {
        try {
            Uri alert = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alert == null) alert = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            Ringtone ringtone = RingtoneManager.getRingtone(getContext(), alert);
            if (ringtone != null) {
                ringtone.play();
                new Thread(() -> {
                    try {
                        Thread.sleep(4500);
                        if (ringtone.isPlaying()) ringtone.stop();
                    } catch (InterruptedException ignored) {}
                }).start();
            }
            JSObject res = new JSObject();
            res.put("ringing", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Falha ao tocar alarme: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        JSObject res = new JSObject();
        res.put("text", MainActivity.pendingSharedText != null ? MainActivity.pendingSharedText : "");
        res.put("uri", MainActivity.pendingSharedUri != null ? MainActivity.pendingSharedUri : "");
        MainActivity.pendingSharedText = null;
        MainActivity.pendingSharedUri = null;
        call.resolve(res);
    }

    @PluginMethod
    public void runLocalLlmPrompt(PluginCall call) {
        String modelId = call.getString("modelId", "qwen2.5-1.5b-instruct-q4_k_m");
        String prompt = call.getString("prompt", "");
        File target = new File(new File(getContext().getFilesDir(), "models"), modelId.replaceAll("[^a-zA-Z0-9._-]", "_") + ".gguf");
        String output = nativeInspectGguf(target.getAbsolutePath(), prompt);
        JSObject res = new JSObject();
        res.put("ok", target.exists());
        res.put("output", output);
        call.resolve(res);
    }
}

