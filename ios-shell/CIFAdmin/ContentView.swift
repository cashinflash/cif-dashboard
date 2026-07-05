import SwiftUI

/// Full-screen shell around the CIF Admin web app. The web content
/// owns the entire display — including the bottom strip iOS withholds
/// from home-screen web apps — because native apps are exempt.
struct ContentView: View {
    @State private var loadFailed = false
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            // Brand green shows behind the status bar while loading.
            Color(red: 0.082, green: 0.502, blue: 0.239)
                .ignoresSafeArea()

            WebView(
                url: URL(string: "https://app.cashinflash.com/app")!,
                loadFailed: $loadFailed,
                reloadToken: $reloadToken
            )
            .ignoresSafeArea()

            if loadFailed {
                VStack(spacing: 14) {
                    Text("F")
                        .font(.system(size: 34, weight: .heavy))
                        .foregroundColor(.white)
                        .frame(width: 72, height: 72)
                        .background(
                            LinearGradient(
                                colors: [Color(red: 0.11, green: 0.70, blue: 0.33),
                                         Color(red: 0.07, green: 0.54, blue: 0.24)],
                                startPoint: .top, endPoint: .bottom))
                        .cornerRadius(18)
                    Text("You're offline")
                        .font(.headline)
                    Text("CIF Admin needs a connection to load live applications and loan data.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                    Button("Retry") {
                        loadFailed = false
                        reloadToken += 1
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 26)
                    .padding(.vertical, 12)
                    .background(Color(red: 0.086, green: 0.639, blue: 0.290))
                    .cornerRadius(10)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(red: 0.961, green: 0.969, blue: 0.961).ignoresSafeArea())
            }
        }
    }
}
