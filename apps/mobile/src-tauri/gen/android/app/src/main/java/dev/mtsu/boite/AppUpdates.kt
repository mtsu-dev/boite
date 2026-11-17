package dev.mtsu.boite

import android.app.Activity
import android.content.pm.PackageInfo
import android.os.Build
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * What the updater of the APK installed outside a store needs from Android:
 * the installed version and version code. The UI picks the release
 * (`lib/app-update-android.ts`) and opens its APK in the browser, which
 * downloads it and hands it to Android's installer. The app itself installs
 * nothing: Play Protect blocks an app that can install packages as harmful.
 */
class AppUpdates(private val activity: Activity, private val webView: WebView) {
  /**
   * Serves the page as `window.BoiteUpdater`, a message port Android injects
   * only into the app's own origin and answers only from its main frame.
   * A WebView too old for that gets no updater, and the UI no Updates card.
   */
  fun attach() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    WebViewCompat.addWebMessageListener(webView, "BoiteUpdater", setOf(ORIGIN)) { _, message, _, isMainFrame, reply ->
      if (!isMainFrame) return@addWebMessageListener
      // This runs on the UI thread: a malformed request is dropped, never thrown.
      val (request, result) = try {
        val request = JSONObject(message.data ?: "")
        request to when (request.optString("cmd")) {
          "info" -> info()
          else -> return@addWebMessageListener
        }
      } catch (_: Exception) {
        return@addWebMessageListener
      }
      reply.postMessage(JSONObject().put("id", request.opt("id")).put("result", result).toString())
    }
  }

  private fun info(): JSONObject {
    val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
    return JSONObject().put("version", info.versionName ?: "").put("code", versionCode(info))
  }

  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

  companion object {
    /** The page's origin: Tauri serves the packaged UI there. */
    const val ORIGIN = "http://tauri.localhost"
  }
}
