package dev.mtsu.boite

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * The app's own updater, for the APK installed outside a store: the UI picks
 * the release (`lib/app-update-android.ts`), this downloads its APK, checks it
 * is this app signed by the same key and newer, and hands it to Android's
 * package installer. Android shows its own confirmation, and refuses an APK
 * signed by another key or with a lower version code whatever this checks.
 */
class AppUpdates(private val activity: Activity, private val webView: WebView) {
  private val worker = Executors.newSingleThreadExecutor()
  private val dir = File(activity.cacheDir, "updates")
  @Volatile private var downloaded: Pair<String, File>? = null

  init {
    live = WeakReference(this)
    // A download from a previous run is not resumed: the UI checks again.
    worker.execute { dir.listFiles()?.forEach { it.delete() } }
  }

  /**
   * Serves the page as `window.BoiteUpdater`, a message port Android injects
   * only into the app's own origin and answers only from its main frame: an
   * HTML view in a frame, whatever its origin, never reaches the installer.
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
          "download" -> { download(request.getString("url"), request.getString("version")); JSONObject.NULL }
          "install" -> install(request.getString("version"))
          else -> return@addWebMessageListener
        }
      } catch (_: Exception) {
        return@addWebMessageListener
      }
      reply.postMessage(JSONObject().put("id", request.opt("id")).put("result", result).toString())
    }
  }

  private fun info(): JSONObject {
    val info = installed()
    return JSONObject().put("version", info.versionName ?: "").put("code", versionCode(info))
  }

  /** Starts the download of `version` from `url`; events report progress and the end. */
  private fun download(url: String, version: String) {
    worker.execute {
      try {
        downloaded?.let { (done, file) -> if (done == version && file.isFile) { emit(JSONObject().put("kind", "downloaded").put("version", version)); return@execute } }
        downloaded = null
        val scheme = Uri.parse(url).scheme
        require(scheme == "https" || scheme == "http") { "$url: expected an http or https address" }
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val part = File(dir, "update.apk.part")
        fetch(url, part)
        val file = File(dir, "update.apk")
        check(part.renameTo(file)) { "${file.path}: could not keep the download" }
        verify(file)
        downloaded = version to file
        emit(JSONObject().put("kind", "downloaded").put("version", version))
      } catch (error: Exception) {
        emit(JSONObject().put("kind", "failed").put("message", error.message ?: error.toString()))
      }
    }
  }

  /**
   * Hands the downloaded APK to Android. "permission" when the app may not
   * install apps yet: Android's page for that opens, and the owner taps
   * Update again once allowed. "missing" when nothing is downloaded.
   */
  private fun install(version: String): String {
    val file = downloaded?.takeIf { it.first == version && it.second.isFile }?.second ?: return "missing"
    if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
      activity.runOnUiThread {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
      }
      return "permission"
    }
    worker.execute {
      try {
        commit(file)
      } catch (error: Exception) {
        emit(JSONObject().put("kind", "installFailed").put("message", error.message ?: error.toString()))
      }
    }
    return "started"
  }

  private fun fetch(url: String, into: File) {
    var connection = URL(url).openConnection() as HttpURLConnection
    // GitHub answers a release download with a redirect to its storage host.
    var hops = 0
    while (true) {
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      connection.instanceFollowRedirects = false
      connection.setRequestProperty("Accept", "application/octet-stream")
      val code = connection.responseCode
      if (code in 300..399 && hops < 5) {
        val from = connection.url
        val next = connection.getHeaderField("Location") ?: error("$from: a redirect with no address")
        connection.disconnect()
        // A relative address is relative to the hop that sent it, not to the first one.
        val target = URL(from, next)
        require(target.protocol == "https" || target.protocol == "http") { "$target: expected an http or https address" }
        connection = target.openConnection() as HttpURLConnection
        hops += 1
        continue
      }
      check(code == 200) { "${connection.url}: the server answered $code" }
      break
    }
    val total = connection.contentLengthLong
    var received = 0L
    var reportedAt = 0L
    connection.inputStream.use { input ->
      into.outputStream().use { output ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
          received += read
          val now = System.currentTimeMillis()
          if (now - reportedAt >= 250) {
            reportedAt = now
            emit(JSONObject().put("kind", "progress").put("received", received).put("total", if (total > 0) total else JSONObject.NULL))
          }
        }
      }
    }
    connection.disconnect()
    check(total <= 0 || received == total) { "${connection.url}: the download stopped at $received of $total bytes" }
  }

  /** The same refusals Android would make, said before its dialog instead of as a bare failure. */
  private fun verify(file: File) {
    val pm = activity.packageManager
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0
    val archive = pm.getPackageArchiveInfo(file.path, flags) ?: error("The download is not an Android app")
    check(archive.packageName == activity.packageName) { "The download is ${archive.packageName}, not ${activity.packageName}" }
    val installed = installed(flags)
    check(versionCode(archive) > versionCode(installed)) { "The download is not newer than the installed app" }
    if (Build.VERSION.SDK_INT >= 28) {
      val mine = installed.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
      val theirs = archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
      check(mine != null && mine == theirs) { "The download is signed by another key than this app" }
    }
  }

  private fun commit(file: File) {
    val installer = activity.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(activity.packageName)
    params.setSize(file.length())
    // Once this app installed itself, later updates need no tap (Android 12+).
    if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    if (Build.VERSION.SDK_INT >= 34) params.setRequestUpdateOwnership(true)
    val id = installer.createSession(params)
    installer.openSession(id).use { session ->
      session.openWrite("base.apk", 0, file.length()).use { output ->
        file.inputStream().use { it.copyTo(output) }
        session.fsync(output)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
      val result = PendingIntent.getBroadcast(activity, id, Intent(activity, InstallResult::class.java), flags)
      session.commit(result.intentSender)
    }
  }

  private fun installed(flags: Int = 0): PackageInfo = activity.packageManager.getPackageInfo(activity.packageName, flags)

  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

  fun emit(event: JSONObject) {
    webView.post { webView.evaluateJavascript("window.__boiteAppUpdate&&window.__boiteAppUpdate($event)", null) }
  }

  companion object {
    /** The page's origin: Tauri serves the packaged UI there. */
    const val ORIGIN = "http://tauri.localhost"
    @Volatile var live: WeakReference<AppUpdates>? = null
  }
}

/** Android's answer to an install: its confirmation to show, or why it refused. */
class InstallResult : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val updates = AppUpdates.live?.get()
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        @Suppress("DEPRECATION")
        val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
        context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      PackageInstaller.STATUS_SUCCESS -> Unit
      PackageInstaller.STATUS_FAILURE_ABORTED -> updates?.emit(JSONObject().put("kind", "installAborted"))
      else -> updates?.emit(JSONObject().put("kind", "installFailed")
        .put("message", intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Android refused the update ($status)"))
    }
  }
}
