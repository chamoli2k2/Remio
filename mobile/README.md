# Remio mobile

Expo (React Native) app for iPhone and Android, using the same backend and theme as the website.

```bash
cd mobile
npm install
cp .env.example .env     # EXPO_PUBLIC_API_URL: https://remio.in, or your local server
npx expo start           # press i for iOS Simulator, a for Android Emulator
```

Local server: run `npm run dev:local` in the repo root (port 4000) and set
`EXPO_PUBLIC_API_URL=http://localhost:4000`. The Android emulator reaches it through `10.0.2.2` automatically.
On a real phone use your computer's LAN address.

Signed-in requests use `X-Auth-Mode: token` with a Bearer access token; tokens live in the Keychain/Keystore.
Answers are queued on the device and synced in batches, so studying works offline.

Not built yet: Google sign-in, in-app signup, creating/editing cards, LaTeX and drawings, rich note editing, push, payments.
