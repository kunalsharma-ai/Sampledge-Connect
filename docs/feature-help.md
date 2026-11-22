# Feature help (the gold "i")

Every major feature shows a small green-and-gold **i** beside its title. It opens a short guide:
what the feature is, why it helps, where to find it (web and phone), how to use it, tips and
related guides. **Feature guides** lists every guide with search.

- Content: `packages/contracts/src/feature-help.ts` (`FEATURE_HELP`). One source for web and
  mobile. Admin-only guides carry `audience` and are hidden from members in the guide list.
- Web: `apps/web/components/feature-help.tsx`. `<FeatureHelp id="…" />` opens a popover; inside a
  modal dialog use `inDialog` (opens the full guide on top). `openFeatureGuide(id?)` opens the guide
  window, also from the command palette (Ctrl+K, "Feature guides") and Settings.
- Mobile: `apps/mobile/src/components/FeatureHelp.tsx` (bottom sheet) and the `/help` screen
  (More > Feature guides). Stack screens get the mark beside their header title from
  `src/lib/featureHelpRoutes.ts`; tab screens place `<FeatureHelp>` in their own headers.

When you add or change a feature, update its entry (or add one and place the mark). Only describe
what is built; the contracts test checks ids, related links and step counts.
