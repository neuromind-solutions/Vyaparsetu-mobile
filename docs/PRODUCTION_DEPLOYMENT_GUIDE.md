# VyapaarSetu Mobile — Production Deployment & Release Guide

This document outlines the step-by-step procedures to build, sign, and distribute the VyapaarSetu Android application in production.

---

## 1. Automated Build Pipeline (GitHub Actions)

The repository includes a production-grade CI/CD workflow at [`.github/workflows/build-android.yml`](../.github/workflows/build-android.yml).

### How to Build a Production APK / AAB
1. **Automatic on Push**: Every push to the `main` branch automatically triggers a build.
2. **Manual Trigger (Actions Tab)**:
   - Navigate to **GitHub Repo** > **Actions** tab.
   - Select **Build Android APK & AAB**.
   - Click **Run workflow** > Select branch `main` > Click **Run workflow**.
3. **Download Artifacts**:
   - Once completed (~2-3 minutes), open the workflow run.
   - Under **Artifacts** at the bottom of the page, download:
     - `VyapaarSetu-APK`: The standalone signed `.apk` file ready to install on any Android phone.
     - `VyapaarSetu-AAB`: The Google Play App Bundle file ready for Play Store upload.

### Creating an Official Tagged Release (v1.0.0)
To publish an official GitHub Release with the APK attached for direct merchant download:
```bash
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions will automatically build, package, and publish a Release at:
`https://github.com/neuromind-solutions/Vyaparsetu-mobile/releases`

---

## 2. Production Keystore Setup (Optional / Recommended)

By default, the CI/CD pipeline automatically signs the release with a fallback release key so builds never fail. For permanent Play Store publishing, provide your own key:

1. Run [`tools/generate-keystore.bat`](../tools/generate-keystore.bat) to generate `vyaparsetu-release.jks`.
2. Convert it to Base64 in PowerShell:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("vyaparsetu-release.jks")) | Set-Clipboard
   ```
3. In **GitHub Repository Settings** > **Secrets and variables** > **Actions**, add:
   - `KEYSTORE_BASE64`: Paste the clipboard value
   - `KEYSTORE_PASSWORD`: The keystore password you chose
   - `KEY_ALIAS`: `vyaparsetu`
   - `KEY_PASSWORD`: The key password you chose

Once these secrets are added, GitHub Actions will automatically use your official signing key for all future builds.

---

## 3. Distribution Channels

### Channel A: Direct Merchant Download (WhatsApp / Website / QR Code)
* **Best for**: Immediate onboarding of APMC traders and farmers without waiting for Google Play review.
* **How to share**:
  1. Download `VyapaarSetu-v1.0.0.apk` from GitHub Actions or Releases.
  2. Send directly over WhatsApp or upload to your company website (`https://yourdomain.com/vyapaarsetu.apk`).
  3. When the merchant taps the file, Android will prompt *"Allow installation from this source"*; clicking allow installs the app in 5 seconds.

### Channel B: Google Play Store
* **Target SDK**: Configured for Android 14/15 (SDK 36) in `variables.gradle`.
* **Play Console Steps**:
  1. Open [Google Play Console](https://play.google.com/console).
  2. Click **Create app** > App name: **VyapaarSetu** > Default language: **Marathi / English** > App or Game: **App** > Free.
  3. Under **Release** > **Internal testing** (or Production), click **Create new release**.
  4. Upload `VyapaarSetu-v1.0.0.aab`.
  5. Fill out the mandatory Store Listing & Data Safety form:
     - **Camera**: Barcode scanning for bill QR codes / physical vegetable tags.
     - **Storage / Files**: Exporting PDF receipts and local database backups.
     - **Data collection**: Zero user tracking / zero advertisements. All business accounting data is stored locally on device.

---

## 4. Production Checklist Before Live Launch

- [x] **Touch UI & Mobile Layout**: Certified safe for all screen sizes (320px–430px+), punch-hole notches, and bottom gesture bars.
- [x] **Offline Database**: IndexedDB (whole paise integer arithmetic) operates with zero internet requirement.
- [x] **Android Keystore Signing**: Configured in `app/build.gradle`.
- [x] **Automated CI/CD**: Workflow configured in `.github/workflows/build-android.yml`.
- [ ] **Cloud Sync (Optional)**: If connecting to cloud, configure Supabase credentials in Settings > Cloud Sync.
- [ ] **License Portal**: If licensing is enforced, ensure license keys are issued via `tools/generate-license.mjs`.
