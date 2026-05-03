---
archetype: mobile
displayName: Mobile App (iOS / Android)
description: A mobile app distributed through the App Store and Play Store. Cross-platform (Expo / React Native) is the default for solo and small-team builders; native (Swift / Kotlin) when platform-specific UX or performance is the product.
useWhen:
  - The primary surface is a phone, not a browser tab.
  - You need camera, biometric auth, push notifications, offline storage, or other native capabilities.
  - Distribution is through the App Store and/or Google Play.
  - Users open the app multiple times a day (mobile usage patterns favor short, frequent sessions).
  - One-handed, on-the-go, or notification-driven interactions are core to the product.
redFlags:
  - You just want the website to "feel mobile-friendly" — that's responsive web in `saas` or `content`.
  - Tablet-only enterprise tool with full keyboard usage — consider `internal` web first.
  - Embedded, IoT, kiosk, or wearable surfaces — different domain entirely.
  - Mobile is a thin wrapper around an existing web app and adds no native capability — ship a PWA from the web app instead.
boundariesRef: archkit-boundaries-mobile
recommendedSkills:
  - archkit-skill-expo
  - archkit-skill-react-native
  - archkit-skill-eas
  - archkit-skill-app-store-review

deploymentModes:
  - id: managed
    label: Managed (Expo + EAS for builds, hosted backend)
    why: |
      Expo Application Services (EAS) handles iOS and Android builds, code signing, App Store / Play Store submission, and over-the-air JS updates. Your backend runs on Vercel/Supabase/Neon. Right default for almost every solo or small-team mobile builder — the alternative (running your own macOS build server, managing certificates and provisioning profiles by hand, writing Fastlane lanes) is a meaningful operational burden that has nothing to do with making your app good. EAS Submit handles the App Store review submission flow which is itself nontrivial.
  - id: selfHosted
    label: Self-hosted (your CI for builds, self-hosted backend)
    why: |
      GitHub Actions with macOS runners (or self-hosted macOS hardware) running Fastlane for builds and submissions; backend on K3s with self-hosted Postgres, auth, observability. Right default when you have native iOS/Android codebases without Expo, when EAS pricing becomes a real cost relative to the team's other spend, or when corporate security policy requires builds to happen on infrastructure you control. Note: App Store and Play Store distribution is *universally managed* — there is no self-hosted alternative for consumer mobile distribution; this mode is about the build pipeline and backend, not the store.

stack:
  primary:
    - name: TypeScript
      role: language
    - name: Expo (with React Native)
      role: cross-platform framework — file-based router, build pipeline, native API access through unimodules
      alt: React Native CLI (when you need native modules Expo doesn't support), Flutter (Dart, separate ecosystem), native Swift/Kotlin (when platform-specific UX is the product)
    - name: Expo Router
      role: file-based routing for React Native — the React Navigation primitives wrapped in a Next.js-style API
      alt: React Navigation directly (more control, more boilerplate)
    - name: TanStack Query
      role: server state — cache, refetch, offline queue, optimistic updates
      alt: SWR, RTK Query, plain fetch (don't)
    - name: Zustand
      role: client state — small, no-Provider store for app-level state
      alt: Jotai, Redux Toolkit (heavier), MMKV-backed atoms for persistent state
    - name: MMKV (via react-native-mmkv)
      role: fast key-value storage backed by native code — the right replacement for AsyncStorage
      alt: AsyncStorage (slow, JS-bridge), expo-secure-store (for credentials specifically)
    - name: Expo SQLite or op-sqlite
      role: structured offline storage when the app needs real local persistence
      optional: true
    - name: PostgreSQL (backend)
      role: same as a SaaS backend — primary database for app data
    - name: Drizzle ORM
      role: backend query builder + migrations
      alt: Prisma, Kysely
  why: |
    Expo + React Native is the right default for solo and small-team mobile because it lets one TypeScript codebase ship to both iOS and Android, and the Expo SDK exposes nearly every native capability (camera, notifications, biometrics, deep links, in-app purchases) without dropping to native code. The trade against fully-native Swift/Kotlin is real (fewer platform-specific affordances, occasional performance ceilings) but the multiplier on shipping speed is large enough that it's almost always correct. MMKV over AsyncStorage matters because AsyncStorage is genuinely slow on real devices and shows up as jank in lists — it's a foundational choice that's hard to swap later.
  tradeoffs: |
    Drop to React Native CLI (no Expo) when you need a native module Expo doesn't support and can't be wrapped via config plugins; this used to be common, but Expo's prebuild + config-plugin model now covers nearly every case. Pick fully-native (Swift / Kotlin) only when platform-specific UX is genuinely the product — Apple-design-language fitness apps, OS-level integrations, AR/ARKit-heavy experiences. Flutter is a fine alternative ecosystem but pulls you out of the JS/TS world and away from the broader React tooling.

hosting:
  primary:
    - name: EAS Build
      role: managed iOS and Android build service — produces signed binaries from your repo
      mode: managed
      alt: Codemagic, Bitrise, Appcircle
    - name: EAS Submit
      role: managed App Store / Play Store submission flow
      mode: managed
      alt: Fastlane (more control, more setup) running via GitHub Actions
    - name: EAS Update
      role: over-the-air JS bundle updates without going through App Store review (subject to Apple's policies)
      mode: managed
      alt: CodePush (Microsoft, deprecated), self-hosted expo-updates server
      optional: true
    - name: Vercel / Railway / Fly.io
      role: backend hosting — same shape as the saas archetype
      mode: managed
      alt: Render, Cloud Run
    - name: Neon, Supabase
      role: backend Postgres
      mode: managed
      alt: Railway Postgres, RDS
    - name: GitHub Actions with macOS runners + Fastlane
      role: build pipeline for iOS (macOS-required) and Android
      mode: selfHosted
      alt: self-hosted macOS hardware (Mac Studio in a closet, MacStadium rental), Xcode Cloud (Apple-only, ties you to Xcode)
    - name: K3s on Hetzner
      role: backend hosting
      mode: selfHosted
      alt: Docker on a single VM, full K8s
    - name: PostgreSQL on the cluster
      role: backend database
      mode: selfHosted
    - name: App Store Connect + Google Play Console
      role: distribution — universal regardless of mode; both stores are the only meaningful distribution channels for consumer mobile
  why: |
    The mobile-specific hosting choice is whether to use **EAS** (managed builds + submission + OTA updates from one provider) or run your own build pipeline with Fastlane on GitHub Actions. EAS is dramatically less effort and is the right default; rolling your own is appropriate when you've already invested in Fastlane lanes, when the team has native iOS expertise, or when EAS pricing meaningfully matters at your scale. The backend half of this archetype is identical to `saas` — Vercel + Neon (managed) or K3s + Postgres (self-hosted). What's *not* a choice is App Store and Play Store distribution: those are the only paths to real users for consumer mobile, and both are entirely "managed" by Apple and Google.
  tradeoffs: |
    Self-hosted macOS hardware is appealing on cost spreadsheets and bad on every other axis — macOS upgrades break Xcode, Xcode upgrades break builds, and one-machine setups are single points of failure. If you must self-host, use cloud macOS rentals (MacStadium, AWS EC2 Mac instances) rather than a Mac mini under a desk. Don't pay for EAS Update if your release cadence is slow and store reviews aren't a bottleneck — over-the-air updates exist to ship hotfixes between store releases, not to skip review entirely.

auth:
  primary:
    - name: Clerk (with Expo SDK)
      role: managed auth — drop-in components, social login, biometric session, organizations
      mode: managed
      alt: Supabase Auth (mobile SDK), Auth0, WorkOS
    - name: Sign in with Apple
      role: required by App Store Review when offering social login on iOS — Apple mandates parity with Google/Facebook/etc.
    - name: expo-secure-store
      role: store auth tokens in iOS Keychain / Android Keystore — required for any tokens persisted on device
    - name: expo-local-authentication
      role: biometric (Face ID / Touch ID / fingerprint) gate on app open or sensitive actions
      optional: true
    - name: Keycloak
      role: self-hosted IdP federating to corporate / consumer identity, with mobile OIDC client
      mode: selfHosted
      alt: Authentik, Authelia, Ory Kratos
  why: |
    Mobile auth has three concerns the web doesn't: secure on-device token storage (expo-secure-store wraps Keychain/Keystore — never use AsyncStorage for tokens), biometric session re-validation (expected UX for finance, health, and any sensitive app), and Sign in with Apple as an *App Store Review requirement* whenever you offer other social logins on iOS. Apple will reject your build if you offer Google/Facebook/email login but not Sign in with Apple. Clerk's Expo SDK handles all of this; rolling your own auth on mobile is more work than on web because of these constraints.
  tradeoffs: |
    Skip biometric gating if your app holds nothing sensitive (a recipe app, a public-data viewer); the friction without payoff isn't worth it. The Sign-in-with-Apple requirement applies only when you offer at least one other third-party login on iOS — a fully-email-based auth flow doesn't trigger it.

networking:
  primary:
    - name: REST or tRPC
      role: backend API — same patterns as the saas archetype; tRPC works in React Native via fetch
    - name: TanStack Query
      role: cache, retry, offline queue, optimistic updates — required for any app that should feel responsive on a flaky connection
    - name: Zod
      role: validate API responses on the device too — server bugs shouldn't crash the app
    - name: Expo Push Notifications (or FCM + APNs directly)
      role: push notifications
      mode: managed
      alt: OneSignal (managed), Firebase Cloud Messaging
    - name: Self-hosted push relay (e.g. ntfy)
      role: push notifications without third-party services
      mode: selfHosted
      alt: direct APNs/FCM integration from your backend (still uses Apple/Google networks, but no third-party hop)
    - name: Deep links + Universal Links / App Links
      role: URL-based navigation into the app from emails, web, and other apps — required for password reset, OAuth callbacks, share sheets
  why: |
    Mobile networking differs from web in three places: connections are unreliable so optimistic updates and offline queues matter (TanStack Query handles both), push notifications require Apple's APNs and Google's FCM behind whatever abstraction you pick, and deep linking is the only way OAuth callbacks and email-driven flows can return users to your app. Universal Links (iOS) and App Links (Android) need server-side configuration files (`apple-app-site-association`, `assetlinks.json`) on your domain — easy to forget, important to test.
  tradeoffs: |
    Use Expo Push Notifications when you're already on EAS — it's simpler and free for typical volumes. Move to OneSignal when you need real campaign management (segments, A/B tests, scheduled sends). Self-hosted push relays (ntfy, Gotify) are appropriate for technical-audience apps but don't help with consumer push because the underlying delivery still goes through APNs/FCM.

ui:
  primary:
    - name: React Native (core components)
      role: View, Text, ScrollView, FlatList, Pressable as the foundational primitives
    - name: NativeWind
      role: Tailwind CSS for React Native — same class API as web, cross-platform-aware
      alt: Tamagui (more capable cross-platform compiler, steeper learning), React Native Stylesheet API directly
    - name: React Native Reanimated
      role: native-thread animations — required for any gesture-driven or scroll-driven UI
    - name: React Native Gesture Handler
      role: native gesture system — paired with Reanimated for swipes, drags, custom interactions
    - name: Expo Image
      role: image rendering with caching, blurhash placeholders, modern format support
      alt: react-native-fast-image (older, well-tested), bare Image (don't, no caching)
    - name: FlashList (Shopify)
      role: virtualized list — replaces FlatList for any list with more than a few hundred items
      optional: true
    - name: Lucide React Native or react-native-vector-icons
      role: icon set
  why: |
    Mobile UI quality is the primary differentiator users notice — animation fluidity, scroll performance, gesture responsiveness, and platform-feel are what separate apps that feel premium from apps that feel like web wrappers. Reanimated runs animations on the native thread (off the JS thread) which is the difference between 60fps gestures and dropped frames. FlashList over FlatList matters the moment you have lists; FlatList recycles views poorly and shows up as jank on real devices. NativeWind brings Tailwind ergonomics to React Native, which keeps web and mobile codebases mentally consistent if your team also ships web.
  tradeoffs: |
    Use Tamagui over NativeWind when you want a single codebase that produces both web and native components from the same source — Tamagui's compiler is more powerful but the learning curve is real. Drop Reanimated only if your app has zero gesture or transition work, which is rare for any app users will use daily.

jobs:
  primary:
    - name: Backend job system
      role: same shape as saas — Inngest (managed) or BullMQ (self-hosted) for server-side work
    - name: expo-background-fetch / TaskManager
      role: very limited periodic work the OS may run when the app is in background — both iOS and Android throttle this aggressively
      optional: true
    - name: Server-driven push as the trigger
      role: most "background work" on mobile is actually a push notification waking the app or backend doing the work and notifying the device
    - name: Inngest
      role: server-side job orchestration
      mode: managed
      alt: Trigger.dev, QStash
    - name: BullMQ
      role: server-side job orchestration
      mode: selfHosted
      alt: Graphile Worker
  why: |
    The most important thing to know about mobile background work is that *it is not the answer to most problems*. Both iOS and Android throttle background fetch heavily — the OS may decide your "every 15 minutes" task runs once an hour or not at all. The reliable pattern is: server-side jobs run on your backend (Inngest or BullMQ), the server sends a push notification when something needs the user's attention, the user opening the app refreshes data via TanStack Query. Trying to do real recurring work on the device leads to bugs nobody can reproduce because they only happen when the OS decides to throttle.
  tradeoffs: |
    Use expo-background-fetch only for genuinely device-local work that doesn't need to be reliable (refresh a cache *if* the OS happens to wake us). Anything user-visible or business-critical belongs server-side.

observability:
  primary:
    - name: Sentry (with React Native SDK)
      role: error tracking + crash reporting (catches both JS errors and native crashes), performance monitoring
      mode: managed
      alt: Bugsnag, Instabug
    - name: PostHog (mobile SDK)
      role: product analytics, funnels, feature flags, session replay (mobile session replay is real and useful)
      mode: managed
      alt: Mixpanel, Amplitude, Firebase Analytics (free, ties you to Firebase)
    - name: App Store Connect + Play Console analytics
      role: built-in install, retention, crash data — already collected by the stores, free
    - name: GlitchTip + native crash reporting
      role: self-hosted error tracking
      mode: selfHosted
      alt: Sentry self-hosted (heavier; native symbol upload is fiddly), Bugsink
    - name: PostHog self-hosted
      role: self-hosted product analytics with mobile SDK
      mode: selfHosted
      alt: Plausible (mobile support is weaker), Umami (web-focused)
  why: |
    Mobile observability is uniquely hard because errors happen on user devices you don't control — you need crash reporting that captures both JavaScript errors and native crashes (with symbol files uploaded to your error tracker so stack traces are readable). Sentry's React Native SDK is the standard answer; the alternative is wiring up native crash reporters (Crashlytics) plus a JS error reporter and stitching them together. PostHog's mobile SDK gives funnels and session replay — session replay is particularly valuable on mobile because users tap places you didn't expect and you can't be over their shoulder.
  tradeoffs: |
    Don't bother with both Sentry and Crashlytics; they overlap and you'll get duplicate alerts. App Store Connect and Play Console give you free install and retention metrics already — don't re-implement those in your analytics tool, instead use them as the source of truth and use PostHog for in-app behavior.

testing:
  primary:
    - name: Jest (or Vitest)
      role: unit + integration tests for plain JS/TS logic
      alt: Vitest works with React Native via configuration but Jest is still the more common default
    - name: Maestro
      role: end-to-end mobile UI tests — YAML-based flow definitions, runs on real devices and simulators, dramatically faster than Detox
      alt: Detox (older, harder), Appium (cross-platform but slow)
    - name: React Native Testing Library
      role: component-level tests with realistic interaction patterns
      optional: true
    - name: TestFlight (iOS) + Play Internal Testing (Android)
      role: real-device beta testing before public release — non-negotiable; your staging environment is users on real devices
  why: |
    Mobile testing has an asymmetry web testing doesn't: simulators and emulators lie. A test that passes in the iOS Simulator can fail on a real iPhone (different keyboard behavior, network conditions, performance budget). Maestro on real devices via TestFlight beta is what catches the bugs that only happen on real hardware. Unit tests catch logic regressions cheaply; Maestro flows catch the wiring (does the login → main screen → main action path still work end-to-end on a real device).
  tradeoffs: |
    Skip Detox unless you've already invested in it; Maestro is dramatically less setup and friction. Skip Appium entirely unless you specifically need cross-browser-like mobile-cloud testing (BrowserStack, Sauce Labs).
---

# Mobile App (iOS / Android)

This archetype is for products whose primary surface is a mobile app distributed through the App Store and Google Play. The default toolchain for solo and small-team mobile builders is Expo + React Native + EAS — one TypeScript codebase ships to both stores, native capabilities are accessible via unimodules, and the build/sign/submit pipeline is managed for you. Native (Swift, Kotlin) is the right pick when platform-specific UX is genuinely the product, not the default.

The hard parts of mobile aren't the code — the hard parts are the App Store review process, code signing, certificate management, push notification delivery (APNs and FCM), deep linking configuration, and the fact that your tests run in simulators that lie about real-device behavior. Each of these has tooling that takes the operational pain out (EAS, Expo Push, Universal Links, Maestro on real devices), but they are choices you must make explicitly because skipping them creates production bugs that are very hard to debug from your laptop.

## What mobile apps optimize for that other archetypes don't

Five concerns dominate decisions in this archetype:

1. **App Store and Play Store policies are constraints, not suggestions.** Apple rejects builds for missing Sign in with Apple, missing privacy disclosures, payment flows that bypass IAP, deceptive screenshots, and a long list of other reasons. Plan submission as a real engineering activity, not a release-day formality.
2. **Real device behavior diverges from simulator behavior.** Performance budgets, gesture handling, network timing, keyboard behavior, and OS-level interruptions all differ between simulators and real iPhones / real Android devices. TestFlight and Play Internal Testing on real hardware is non-negotiable before public release.
3. **Background work is unreliable by design.** Both operating systems throttle background fetch and tasks aggressively. The reliable pattern is server-side jobs that send push notifications; on-device background work is best-effort only.
4. **Token storage and biometrics matter.** Use expo-secure-store (Keychain / Keystore), not AsyncStorage, for any auth tokens. Biometric session re-validation is the expected UX for any app handling sensitive data.
5. **Update cadence is constrained.** Store review takes hours to days; you cannot ship a hotfix in fifteen minutes the way you can on web. Over-the-air JS updates (EAS Update, CodePush) exist within Apple's policies as a partial mitigation but cannot replace native binary updates.

## The managed vs. self-hosted decision

For mobile, the deployment-mode split is more about the *build pipeline* and *backend* than about the app distribution itself — which is universally Apple and Google. **Managed** (EAS for builds + submissions + OTA updates, Vercel/Neon for backend) is dramatically less effort and is the right default. **Self-hosted** (GitHub Actions with macOS runners + Fastlane + K3s backend) is appropriate when EAS pricing matters relative to your costs, when you have native iOS/Android codebases without Expo, or when corporate security requires builds on infrastructure you control. There is no self-hosted alternative for getting an app onto consumer phones — both stores are the only paths.

If your "mobile app" is a thin wrapper around a web app and adds no native capability, you're better off shipping a Progressive Web App from the existing web codebase — pick `saas` or `content` and add PWA support there.
