# UI Development Plan

## Starting Point

The base `react-video-client-avatar` client uses a 2x2 CSS grid layout with tabbed navigation for the Avatar, Thymia (voice biomarkers), and Shen (camera vitals) panels. Only one panel is visible at a time — you must click tabs to switch between them.

**Problem:** During a wellness conversation, the operator needs to see the avatar, voice biomarkers, and camera vitals simultaneously.

## UI Changes

### 1. Show All Three Panels at Once

**Guidance:** Split the current avatar area into 2 columns — left column has avatar above video biometrics (Shen), right column is voice biometrics (Thymia). Keep the rest the same.

**Implementation:** Replace the `MobileTabs` component in the desktop avatar area with a two-column flex layout:

- **Left column** (`flex-1`): Avatar video (top half) stacked above Shen camera vitals panel (bottom half), sharing space equally via `flex-1`
- **Right column** (fixed `w-[340px]`): Full Thymia voice biomarkers panel, scrollable
- Controls bar spans full width below both columns
- Mobile layout unchanged (still uses tabs — screen too small for side-by-side)

### 2. Match Font Sizes Between Panels

**Guidance:** Video biometric font too large, make same size as voice bios.

**Implementation:** The Shen panel (from `@agora/agent-ui-kit`) uses `text-sm` (14px) and `text-xs` (12px). The Thymia panel uses `text-[11px]` and `text-[10px]`. Since both are from node_modules, added a `.shen-compact` CSS wrapper class that overrides:

- `text-sm` → 11px
- `text-xs` → 10px
- Tighter padding and gaps to match Thymia's compact density

### 3. Move Safety Analysis to Bottom

**Guidance:** Put the Safety Analysis at bottom of voice list so we can scroll down to it.

**Implementation:** Added `.thymia-safety-last` CSS class on the Thymia panel wrapper. Uses CSS `:has()` selector to target the SafetySection (identified by its unique `space-y-1.5` inner div) and applies `order: 99` to push it below the biomarker score sections.

### 4. Hide Progress Counters Once Metrics Arrive

**Guidance:** Hide the title of the voice once metrics arrive (i.e. "Helios 8.3/10s, Psyche 2.0/5s, Apollo 0.0/20s").

**Implementation:** CSS rule on `.thymia-safety-last` that hides the progress section (first child with `flex-wrap` class) when followed by sibling score sections (detected via `:has(~ div > h3)`). Progress counters show during warmup, disappear once real biomarker data populates.

### 5. Compact Header

**Guidance:** Make the main page title less tall. Reduce whitespace/padding between title and top of UI components.

**Implementation:**
- Header padding reduced from `py-3 md:py-4` → `py-1 md:py-1.5`
- Font sizes reduced: title `text-sm md:text-base`, subtitle `text-[10px] md:text-xs`
- Icon and title on same line (horizontal flex)
- Main content area padding reduced from `py-1 md:py-6` → `py-0 md:py-1`

### 6. Branding

- Title changed to "Claude Hackathon at Imperial College"
- Subtitle: "By Ben, Nick, Beejal, Anton, Tan"
- Agora logo replaced with Claude sparkle icon (inline SVG, coral #E8734A)

## Final Desktop Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ✦ Claude Hackathon at Imperial College          [theme] [⚙] │
│   By Ben, Nick, Beejal, Anton, Tan                           │
├──────────────┬───────────────────────────────────────────────┤
│              │ ┌─────────────────┐ ┌───────────────────────┐ │
│  Chat /      │ │  Avatar Video   │ │ Thymia Voice          │ │
│  Conversation│ │  (Anam)         │ │ Biomarkers            │ │
│              │ ├─────────────────┤ │                       │ │
│              │ │  Shen Panel     │ │ Emotions (2-col)      │ │
│              │ │  Camera Vitals  │ │ Wellness scores       │ │
│              │ │  HR, HRV, BP   │ │ Clinical scores       │ │
│              │ └─────────────────┘ │ Safety Analysis       │ │
│              │ [🎤] [📹] [End Call]│ (scrollable)          │ │
├──────────────┤                     └───────────────────────┘ │
│ Local Video  │                                               │
│ / Shen Cam   │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

## Files Changed

| File | Changes |
|------|---------|
| `react-video-client-avatar/components/VideoAvatarClient.tsx` | Two-column layout, compact header, Claude branding |
| `react-video-client-avatar/app/globals.css` | `.shen-compact`, `.thymia-safety-last`, progress hiding rules |
| `react-video-client-avatar/.env.local` | Shen + Thymia enabled, HACK profile default |
| `simple-backend/.env` | HACK profile with all provider credentials |
