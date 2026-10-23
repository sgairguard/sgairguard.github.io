# Privacy Policy for SG AirGuard

**Effective date:** 30 October 2026
**App:** SG AirGuard (`com.sgairguard`) on Google Play
**Developer:** SG AirGuard
**Contact:** sgairguard.app@gmail.com

---

## 1. Summary

- SG AirGuard has **no accounts** and asks for **no personal details**: no name, email, phone number or location permission.
- Your settings (region, health profile, alert levels) and the latest air readings stay **on your phone**.
- The free app shows **advertising from Google AdMob**. Google may collect device identifiers and usage data to show and measure those ads, as described in section 4.
- The developer runs **no servers** and receives no data about you.

---

## 2. Information stored only on your device

To run alerts and work offline, SG AirGuard saves these on your phone, in app-private storage:

- **Preferences:** primary region, favourite town, health profile, alert thresholds, reminder interval, quiet hours, language and display settings.
- **Cached readings:** the latest PM2.5, PSI, weather and forecast data from data.gov.sg, so the app opens instantly and works offline.
- **Alert state:** which alerts have already been sent, so you are not notified twice.
- **Ad consent:** your choice from Google's consent form, where it is shown (stored by Google's consent SDK on your phone).

None of this is sent to the developer. Cloud backup is turned off (`android:allowBackup="false"`). Clearing the app's storage or uninstalling the app deletes all of it.

---

## 3. Air quality data

SG AirGuard downloads public environmental data over HTTPS directly from data.gov.sg (`api-open.data.gov.sg` and `api.data.gov.sg`), published under the Singapore Open Data Licence. Like any website, those servers receive your device's IP address and a standard network request. SG AirGuard sends no personal information to data.gov.sg.

---

## 4. Advertising (Google AdMob)

SG AirGuard is free and supported by advertising. Ads are provided by **Google AdMob**, part of Google LLC. To show, limit and measure ads, and to prevent fraud, the Google Mobile Ads SDK in the app may collect and share with Google:

- **Device identifiers**, including the Android **Advertising ID**
- **Approximate location**, derived from your IP address (SG AirGuard itself never asks for location permission)
- **App interactions with ads** (impressions, taps) and **diagnostics** (crash and performance information of the ads SDK)

Google processes this data under its own privacy policy. Learn more:

- How Google uses information from apps that use its services: https://policies.google.com/technologies/partner-sites
- Google Privacy Policy: https://policies.google.com/privacy

**Your choices**

- **Ad personalisation:** on Android, go to *Settings → Google → Ads* (or *Settings → Privacy → Ads*) to delete or reset your Advertising ID, or to opt out of personalised ads. You will still see ads, but they will be less relevant.
- **Consent:** where the law requires it (for example in the EEA and UK), the app shows Google's consent form before any ad is requested, and an **Ad privacy** option in Settings lets you change your choice at any time.
- Ads are never placed inside haze alerts, notifications or health advice.

---

## 5. Permissions

| Permission | Why |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Download air quality data and ads; skip requests when you are offline |
| `POST_NOTIFICATIONS` | Haze alerts; asked only when you turn alerts on (Android 13+); you can revoke it in Android settings |
| `RECEIVE_BOOT_COMPLETED` | Restart scheduled air checks after your phone restarts |
| `SCHEDULE_EXACT_ALARM` | Run the hourly air check on time, so alerts arrive promptly; works with reduced accuracy if you deny it |
| `com.google.android.gms.permission.AD_ID` | Added by the Google Mobile Ads SDK to read the Advertising ID for ads (section 4) |
| `ACCESS_ADSERVICES_AD_ID`, `ACCESS_ADSERVICES_ATTRIBUTION`, `ACCESS_ADSERVICES_TOPICS` | Added by the Google Mobile Ads SDK for Android's Privacy Sandbox ad services (section 4) |
| `WAKE_LOCK` | Added by Android WorkManager so a background air check can finish |

SG AirGuard does **not** request location, contacts, camera, microphone, storage or phone permissions.

---

## 6. Children

SG AirGuard is a general-audience app and is not directed at children under 13. We do not knowingly collect personal information from children.

---

## 7. Data retention and deletion

The developer stores no data about you. Data on your device stays until you clear the app's storage or uninstall it. For data collected by Google for advertising, use the choices in section 4 or Google's tools at https://myaccount.google.com.

---

## 8. Security

All network traffic uses HTTPS; unencrypted HTTP is blocked by the app's network security configuration. App data is kept in Android's private app storage.

---

## 9. Not a government app, and not medical advice

SG AirGuard is an independent app. It is **not** affiliated with, endorsed by or sponsored by the National Environment Agency (NEA), the Ministry of Sustainability and the Environment, or any Singapore government agency. Data source: https://data.gov.sg under the Singapore Open Data Licence (https://data.gov.sg/open-data-licence).

Health information in the app follows public guidance from NEA and the Ministry of Health and is for general awareness only. It is not medical advice. If you have a heart or lung condition, consult a doctor.

---

## 10. Changes to this policy

When this policy changes, the new version is posted at the same address with a new effective date. Significant changes are also mentioned in the app's release notes on Google Play.

---

## 11. Contact

Questions or requests about privacy: **sgairguard.app@gmail.com**
