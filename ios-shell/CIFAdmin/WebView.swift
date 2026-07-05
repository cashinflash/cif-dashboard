import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var loadFailed: Bool
    @Binding var reloadToken: Int

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()   // persistent cookies = login survives relaunch

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true   // swipe-back = PWA back gesture
        webView.scrollView.contentInsetAdjustmentBehavior = .never  // the page handles safe areas itself
        webView.scrollView.bounces = false                    // page is a frozen shell; inner views scroll
        webView.isOpaque = false
        let chrome = UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1)  // #f2f2f7
        webView.backgroundColor = chrome
        webView.scrollView.backgroundColor = chrome
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            webView.load(URLRequest(url: url))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: WebView
        var lastReloadToken = 0
        init(_ parent: WebView) { self.parent = parent }

        /// The admin stays inside the shell; Vergent, the portal,
        /// tel:/sms:/mailto: links all open in the system apps.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow); return
            }
            let scheme = url.scheme?.lowercased() ?? ""
            if ["tel", "sms", "mailto", "facetime"].contains(scheme) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel); return
            }
            if scheme == "http" || scheme == "https" {
                if (url.host?.lowercased() ?? "") == "app.cashinflash.com" {
                    decisionHandler(.allow); return
                }
                UIApplication.shared.open(url)
                decisionHandler(.cancel); return
            }
            decisionHandler(.allow)
        }

        /// target=_blank (Open in Vergent, PDFs, portal links) — WKWebView
        /// ignores these without this hook; hand them to Safari.
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(_ webView: WKWebView,
                     didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) {
            let code = (error as NSError).code
            let offline = [NSURLErrorNotConnectedToInternet, NSURLErrorTimedOut,
                           NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
                           NSURLErrorNetworkConnectionLost].contains(code)
            if offline {
                DispatchQueue.main.async { self.parent.loadFailed = true }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async { self.parent.loadFailed = false }
        }
    }
}
