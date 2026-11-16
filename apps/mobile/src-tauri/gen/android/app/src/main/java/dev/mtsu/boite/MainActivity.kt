package dev.mtsu.boite

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    // The page says when its first screen is on the glass. Android then logs
    // "Fully drawn" with the time since launch, the number `am start -W` and
    // the Play vitals report as time to full display.
    webView.addJavascriptInterface(ReadySignal(), "BoiteAndroid")
  }

  private inner class ReadySignal {
    @JavascriptInterface
    fun ready() {
      runOnUiThread { reportFullyDrawn() }
    }
  }
}
