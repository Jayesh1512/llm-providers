---
name: LLM Providers — Cobalt Peer Workspace
description: Light geometric typography and precise charcoal operations beneath a cobalt landscape.
colors:
  page: "#17181b"
  surface: "#202125"
  ink: "#f1f2f5"
  muted: "#b0b4c0"
  line: "#3c3e46"
  accent: "#b4bfff"
  action: "#e8ecff"
  action-ink: "#161a2d"
  action-hover: "#c7d0ff"
  error: "#ffb7a2"
  field-ground: "#1a1c23"
  field-line: "#636878"
  disabled-ground: "#292b32"
  disabled-ink: "#9ea3b0"
  disabled-line: "#41434c"
typography:
  display:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "clamp(36px, 4.5vw, 64px)"
    fontWeight: 300
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "44px"
    fontWeight: 300
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  panel-title:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  copy:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.6
  helper:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.7
  identifier:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "3px"
  connection-group: "4px"
  connection-tab: "2px"
  demo-pane: "8px"
  workspace: "12px 12px 0 0"
spacing:
  icon-gap: "9px"
  field-gap: "7px"
  compact: "12px"
  related: "16px"
  section: "20px"
  panel: "24px"
  workspace-gutter: "30px"
  wide-gutter: "48px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    padding: "5px 0"
  input:
    backgroundColor: "{colors.field-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    width: "100%"
  navigation:
    textColor: "{colors.muted}"
    padding: "17px 1px 15px"
  connection-navigation:
    textColor: "{colors.muted}"
    rounded: "{rounded.connection-tab}"
    padding: "5px 17px"
  connector-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "{spacing.panel}"
  badge:
    backgroundColor: "#2b3149"
    textColor: "#d0d8ff"
    rounded: "{rounded.control}"
    padding: "3px 8px"
  request-panel:
    backgroundColor: "#252730"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "{spacing.panel}"
  demo-pane:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.demo-pane}"
    padding: "{spacing.panel}"
---

# Design System: LLM Providers — Cobalt Peer Workspace

## Overview

**Creative North Star: "The Cobalt Peer Workspace"**

Light geometric type and a vivid natural landscape introduce a precise, charcoal workspace. The original cobalt basalt and orange-sky image supplies atmosphere; compact operational controls supply clarity. Broad introductory gutters give way to bounded panels, thin dividers, exact identifiers and restrained periwinkle actions.

The visual system translates the pinned Letta agent reference through independent imagery and locally hosted OFL Space Grotesk. Its durable identity is the relationship between expressive context and calm operations. The landscape overlap belongs to the introductory surface; the personal demo applies the same type, palette and controls without requiring a landscape header. Concrete testnet language and inspectable identity take priority over promotional claims.

**Key Characteristics:**

- Cobalt landscape atmosphere above charcoal operations.
- Light geometric headlines and compact, readable operational text.
- Nearly square controls, thin borders and tonal layering.
- Pale periwinkle actions and visible keyboard focus.
- Local motion with an explicit reduced-motion override.

## Colors

The operational palette is cool and low-glare; the landscape supplies the stronger cobalt and orange contrast without extending those colors into every control. Frontmatter is the normative color source.

### Primary

- **Periwinkle Signal** (`accent`): links, secondary text actions and selected identity emphasis.
- **Pale Action** (`action`, `action-ink`, `action-hover`): filled buttons use a light ground with dark text; hover strengthens the periwinkle tint.
- **Warm Error** (`error`): text in error banners, supported by the component's muted brown ground and border. It denotes a problem rather than an accent choice.

### Neutral

- **Charcoal Page** (`page`): the outer page and main operational window.
- **Charcoal Surface** (`surface`): connector cards, network summaries and demo panes.
- **Soft Ink** (`ink`) and **Cool Muted** (`muted`): primary information and supporting explanations.
- **Divider** (`line`): boundaries between related operations and panels.
- **Field Ground** and **Field Line** (`field-ground`, `field-line`): distinct entry surfaces with a stronger stroke than structural dividers.
- **Disabled Ground, Ink and Line** (`disabled-ground`, `disabled-ink`, `disabled-line`): visibly unavailable buttons. Do not imply availability through a bright action treatment.

### Named Rules

**The Operational Calm Rule.** Keep saturated landscape color in imagery; use the charcoal and periwinkle palette for working controls.

## Typography

**Display Font:** Space Grotesk, with sans-serif fallback.
**Body Font:** Space Grotesk, with sans-serif fallback.
**Label/Mono Font:** Space Grotesk for labels; system monospace for exact model IDs and addresses.

**Character:** Airy geometric display text anchors a compact utility scale. Real locally hosted files supply light, regular and medium weights; `font-synthesis: none` prevents invented weight styles.

### Hierarchy

- **Display**: light introductory headline, tightly tracked, balanced and limited to about 15 characters per line. The stylesheet overrides its size to 52px at 1100px, 48px at 900px and 36px at 600px; the narrow-screen line height becomes 1.15.
- **Headline**: light personal-demo heading; its narrow-screen size is 33px at 800px.
- **Title**: main task heading; mobile size is 23px with 1.25 line height.
- **Panel Title**: regular internal section labels. Connector and demo-pane headings use the related 22px size; main section headings use 23px.
- **Body / Copy**: the base establishes the reading rhythm; operational descriptions use the smaller copy scale with generous line height and widths typically between 55ch and 75ch.
- **Label / Helper**: medium field and action labels sit above regular supporting text. Supporting metadata remains sentence case.
- **Identifier**: exact models and addresses use monospace and wrap long values instead of truncating away identity.

### Named Rules

**The Weight Before Ornament Rule.** Use light display text, regular headings and medium action labels to create hierarchy before adding decoration.

## Layout

The desktop introduction has a 1440px maximum width and wide horizontal gutters. The main window is capped at 1320px, overlaps the introduction by 36px and uses a 30px internal gutter. Below 1400px the window receives 32px outer margins. At 600px it uses 14px margins, a 30px overlap and 18px internal gutters; introductory gutters become 24px. The window bar is 46px high, reducing to 42px on narrow screens.

Related controls usually sit 16px apart; panel interiors and major related groups use 24px. Connector cards use equal two-column tracks until 600px, then stack. Forms use two equal tracks with a 14px gap until the same breakpoint. Supplier/node and network setup use two tracks with a 40px gap, reducing to 25px at 1100px and stacking at 900px.

The final consumer flow is linear: a 920px-wide region contains model/provider selectors in `1fr 1.2fr` tracks with a 24px gap, followed by a request panel capped at 760px. Selectors stack at 650px. The earlier parallel-market layout is not the current consumer composition. Rate tables scroll horizontally on mobile, with a 620px minimum table width.

The personal demo has a 1440px maximum width, 40px page gutters and a 24px gap between `1fr` and `1.15fr` panes. At 800px the panes stack, page gutters become 18px and pane padding becomes 20px. Catalog action rows stack at 640px. These are distinct observed thresholds, not a synthesized generic breakpoint scale.

## Elevation & Depth

There are no box shadows. Depth comes from tonal grounds, single-pixel borders, the introductory window overlap and a two-pixel periwinkle top edge on the request panel. The image has a directional dark overlay for text legibility. Error and warning banners use tinted grounds and strokes. Hover changes color; it does not lift controls.

### Named Rules

**The Bordered Depth Rule.** Distinguish operations with tonal layers and thin strokes; preserve the flat resting surface.

## Shapes

Controls are nearly square with the small control radius; connector cards and request panels have square corners. The connection-method group has a slightly larger outer radius and a tighter selected tab. Demo panes have their own softer container radius. Only the overlapping window's upper corners are rounded; on mobile those upper corners reduce to 9px. Small circular status indicators remain native status geometry, not a card-radius rule.

## Components

### Buttons

Compact and deliberate. Filled and outlined variants share the frontmatter's padding and type, a 42px minimum height and a one-pixel border. The outlined variant uses a transparent ground and `#656978` stroke; hover uses `#32353f` and `#8f95a6`. Small actions have a 36px minimum height. Text actions are underlined, unfilled and have a 32px minimum height. Disabled colors override all button variants. Focus is a two-pixel `#b7c3ff` outline with a four-pixel offset.

### Chips

The compact status badge has a one-pixel `#596080` border and 11px regular text. It represents an existing state or identifier; it is not styled as an interactive filter.

### Cards / Containers

Connector cards are square, bordered and flat. Their heading pairs a restrained provider mark with a regular heading and muted account-method label. A divider separates explanatory copy from status and action. Demo panes reuse the same surface and border with their dedicated radius; an internal divider separates the numbered pane heading from its work area. Request panels are square, slightly brighter and identified by their accent top edge.

### Inputs / Fields

Entry surfaces use the field ground and stroke, 44px minimum height and 13px text. Labels use the medium label scale; label-to-field gap is 7px. Placeholder color is `#a9aebc`. Textareas use 118px minimum height, 1.7 line height and vertical resizing. Focus shares the global outline. Read-only fields use accent text on `#1c1d21`; errors appear in an adjacent banner rather than an invented red-field style.

### Navigation

Primary navigation uses a flat row, 32px gap and a two-pixel `#bec8ff` underline for the selected tab; muted unselected text becomes ink on hover. Mobile gap is 25px. Nested connection navigation uses a bordered `#25272d` group with 4px padding and 5px gap; selected tabs use `#444a63` with `#f3f5ff` text. Both expose semantic tabs and keyboard arrow/Home/End navigation.

### Disclosures and Motion

Secondary setup is separated by rules and opened in place. Plus/minus marks are disclosure affordances; advanced settings use an inline SVG chevron. The key form reveals through a short clip animation (240ms, `cubic-bezier(.16,1,.3,1)`), while button colors transition over 150ms. Pending feedback fades over one second; refresh icons rotate over 1.5 seconds. Reduced-motion preference disables every animation and transition and returns scroll behavior to auto.

## Do's and Don'ts

### Do:

- **Do** use the frontmatter tokens for operational surfaces, text and controls.
- **Do** keep strong landscape color in imagery and retain a dark legibility overlay when type sits on it.
- **Do** pair light headlines with regular section headings and medium action labels.
- **Do** keep exact identifiers inspectable and wrap long values.
- **Do** preserve visible focus, semantic selected states and the reduced-motion override.
- **Do** describe unavailable or unchecked capabilities plainly beside their controls.

### Don't:

- **Don't** turn compact controls into pills or add lifted hover motion to this flat workspace.
- **Don't** add decorative shadows to replace the observed tonal and bordered hierarchy.
- **Don't** treat the introduction's landscape overlap as mandatory for every screen.
- **Don't** style an unavailable operation as an enabled primary action.
- **Don't** promote unused stylesheet declarations or dead selectors into future design rules.

Evidence: final `src/styles.css`, `src/App.tsx`, `src/Accounts.tsx`, `src/Intro.tsx`, `src/Demo.tsx`, `src/main.tsx`, the surface contract, PRODUCT.md and finish-review captures. The sidecar contains ten self-contained rendered component previews, including actual font subsets and custom properties with literal fallbacks. Script-free preview frames let those fonts load reliably when the panel injects the snippets into a shadow root; frame sizing is preview scaffolding, not a product token. Tonal ramps are synthesized preview metadata, not additional application tokens.

Not canonized or repaired: the two retained overused-font detector warnings are recorded as the licensed reference translation's known tradeoff, not a mandate to use Space Grotesk elsewhere. The unused `.eyebrow` selector and unused `--raised` declaration are excluded; no kicker rule is established. This documentation pass makes no application changes.
