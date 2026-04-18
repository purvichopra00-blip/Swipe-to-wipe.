# 🛡️ Production Security Credentials

These fingerprints are critical for **Firebase Phone Auth** and **Play Store Ads** to work in the final released app.

### Google Play Signing Certificates
*Provided by user on April 16, 2026*

| Type | Fingerprint |
| :--- | :--- |
| **MD5** | `32:16:5C:8C:67:C5:68:CD:CF:AF:35:0D:7E:08:A0:B1` |
| **SHA-1** | `94:67:52:3D:A4:94:57:26:B7:17:10:48:7C:AA:2E:77:18:89:FC:C4` |
| **SHA-256** | `BE:9E:1E:77:F0:C3:0B:C4:3F:2E:BD:F5:88:CC:00:76:1C:82:E3:3D:10:4A:22:8D:2A:50:F7:A9:B7:BB:08:1D` |

### Upload Key Certificate
| Type | Fingerprint |
| :--- | :--- |
| **MD5** | `25:0F:2B:EE:CC:05:27:8A:40:2C:2B:8D:02:75:F1:C3` |
| **SHA-1** | `56:59:7C:49:83:53:7D:87:E5:81:91:51:57:75:F1:2B:81:30:23:6F` |
| **SHA-256** | `84:0A:AC:1F:E4:8F:9C:3F:61:9C:DA:76:40:C5:CD:E7:07:31:79:A2:2D:42:ED:D3:D6:57:10:19:8E:AD:99:D6` |

---

### ⚠️ ACTION REQUIRED (May 1st)
For your **OTP (Firebase)** to work on Android, you MUST:
1.  Go to **Firebase Console** > **Project Settings**.
2.  Select your **Android App**.
3.  Click **"Add Fingerprint"**.
4.  Paste both the **SHA-1** and **SHA-256** values listed above.

> [!CAUTION]
> If these are not added to Firebase, the "Phone Verification" will fail on real Android devices.
