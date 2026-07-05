# CIF Admin — native iOS shell

A ~150-line native app whose only job is showing **app.cashinflash.com**
truly full-screen. iOS 26 withholds the bottom ~68pt of the screen from
home-screen web apps; native apps are exempt — this shell reclaims those
pixels. Everything else (features, data, updates) is the same web app and
keeps deploying instantly through Render; the shell itself should almost
never need changes.

Behavior baked in:
- Full screen incl. under the status bar (green) and home indicator.
- Login cookies persist between launches (same session rules as the web).
- Swipe-from-left-edge = back (closes modals, same as the PWA gesture).
- `Open in Vergent` / portal links / tel: / sms: open in Safari & system
  apps; only app.cashinflash.com stays inside the shell.
- Offline: native retry screen.
- Portrait-locked, iPhone-only, brand-green launch screen, F-bolt icon.

## One-time setup (Mac)

1. **Apple Developer Program** — enroll at
   https://developer.apple.com/programs/enroll/ ($99/yr, approval usually
   under a day). A free account also works but re-expires every 7 days —
   not recommended.
2. **Xcode** — install from the Mac App Store (large download).
3. Get this folder onto the Mac (GitHub → Code → Download ZIP, or clone),
   then open `CIFAdmin.xcodeproj`.
4. Xcode → Settings → Accounts → **+** → sign in with the Apple ID from
   step 1.
5. Click the blue **CIFAdmin** project icon (left sidebar) → target
   **CIFAdmin** → *Signing & Capabilities* → check **Automatically manage
   signing** → pick your **Team**. If the bundle id collides, change
   `com.cashinflash.cifadmin` to anything unique (e.g. add a suffix).
6. Plug in the iPhone (cable). First time only: on the phone enable
   **Settings → Privacy & Security → Developer Mode** (appears after the
   first attempt; requires a restart).
7. Select your iPhone in the toolbar device menu → press **▶ Run**.
   If the phone complains about an untrusted developer:
   **Settings → General → VPN & Device Management → trust your team.**
8. Delete the old home-screen bookmark. Done.

## Yearly renewal

Development-signed apps expire after ~1 year (7 days on free accounts).
The app will simply refuse to open — plug the phone into the Mac, open
the project, press **▶ Run** again. Five minutes.

## If Xcode shows signing errors

99% of the time: the Team isn't selected (step 5) or the bundle id needs
a unique suffix. Both live in *Signing & Capabilities*.
