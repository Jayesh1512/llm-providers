---
name: LLM Providers
description: An exchange ledger for direct peer inference on Monad testnet.
colors:
  page: "#f5f4ef"
  surface: "#ffffff"
  secondary-surface: "#eeede7"
  ink: "#202923"
  muted: "#59635c"
  line: "#d7dcd4"
  accent: "#236444"
  accent-hover: "#194f34"
  selected: "#eef5ed"
  secondary-hover: "#e9eee5"
  focus: "#70a781"
  error: "#9b302d"
  error-surface: "#fff0ed"
  warning: "#795915"
  warning-surface: "#faf3e1"
typography:
  display:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 550
    lineHeight: 1.5
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  compact:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  button:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  data:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  compact: "4px"
  badge: "5px"
  control: "7px"
  panel: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  compact: "12px"
  md: "16px"
  panel: "20px"
  lg: "24px"
  column: "28px"
  section: "32px"
  gutter: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    typography: "{typography.button}"
    padding: "4px 0"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 11px"
  badge:
    backgroundColor: "#edf2e7"
    textColor: "{colors.accent}"
    rounded: "{rounded.badge}"
    padding: "4px 8px"
  navigation:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "16px 0 15px"
  market:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  request-ledger:
    backgroundColor: "{colors.secondary-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "23px 24px"
---

# Design System: LLM Providers

## Overview

**Creative North Star: "The Exchange Ledger"**

LLM Providers is a calm operating interface: exact identities, separate supplier prices, and visible transaction states establish its character. Warm paper surrounds white comparison surfaces and a quieter request ledger. Compact type, structural hairlines, and restrained green controls keep consequential actions easy to locate.

The system treats real chain and local configuration state as the material of the interface. Empty states explain the missing state and offer a next action; status and recovery messages stay beside the relevant task. Product language remains concrete about testnet operation.

**Key Characteristics:**
- Warm neutral surfaces with a restrained forest-green action color.
- A compact sans interface paired with monospace machine identifiers.
- Structural separators, aligned numeric columns, and bounded task panels.
- Explicit pending, error, recovery, and confirmed states.

## Colors

The palette reads as warm paper, dark green ink, and a forest-green operational accent; the frontmatter owns exact values.

### Primary
- **Forest Green** (`accent`): primary buttons, active navigation, links, confirmed phases, and action context.
- **Deep Forest** (`accent-hover`): primary button hover.
- **Selected Wash** (`selected`): the currently selected supplier row.
- **Focus Green** (`focus`): keyboard focus outlines.

### Neutral
- **Warm Paper** (`page`): the page ground.
- **White Surface** (`surface`): supplier tables, inputs, and response content.
- **Ledger Paper** (`secondary-surface`): request and registry-summary panels.
- **Green Ink** (`ink`): headings, labels, and exact data.
- **Muted Ink** (`muted`): explanatory text, metadata, and inactive navigation.
- **Registration Line** (`line`): panel edges and task separators.
- **Hover Wash** (`secondary-hover`): secondary button hover.

### Semantic States
- **Error Ink / Error Paper** (`error`, `error-surface`): recoverable error banners.
- **Warning Ink / Warning Paper** (`warning`, `warning-surface`): setup and wallet warnings.

**The Operational Accent Rule.** Green identifies an action, selection, or confirmed state. Keep neutral surfaces dominant.

## Typography

**Display and Body Font:** DM Sans, with system-ui and sans-serif fallbacks. The fallback is resilience, not the intended display face.

**Data Font:** ui-monospace, SFMono-Regular, monospace for addresses, exact model identifiers, and code.

DM Sans supplies a measured, compact interface with modest negative tracking on headings. Labels use sentence case. Prices and budgets use tabular numerals, preserving comparison without turning every value into monospace.

### Hierarchy
- **Display:** the frontmatter display role is the desktop page heading; it reduces to (28px) at the compact desktop breakpoint and (27px) on mobile.
- **Headline:** section headings use the headline role; ledger and empty-state titles use the smaller title role. Ledger panel titles use weight (600).
- **Body:** the root body role establishes the base; working table rows, controls, and most explanations use (13px), with page summaries at (14px).
- **Label:** form labels use the label role; table headers, helper text, and ledger metadata use (11px). Helpers have line height (1.6–1.7).
- **Data:** machine identifiers use the data role; actionable model identifiers increase to weight (600).

**The Exact Identifier Rule.** Use monospace for inspectable machine identifiers; align prices to the right with tabular numerals and explicit units.

## Layout

The centered app has a maximum width of (1600px). Desktop header, navigation, main content, and footer share (48px) side gutters. Main content begins with (36px) top space. Task panels use compact internal spacing, while independent sections gain larger separation.

The marketplace uses a flexible comparison column beside a request ledger (360px), with a column gap of (28px). At (1400px) and above, the ledger grows to (390px), the gap to (32px), and table rows receive more vertical space. At (1150px) and below, gutters reduce to (32px), the ledger to (325px), and the gap to (22px).

At (1050px) and below, comparison and request panels stack. At (650px) and below, gutters reduce to (20px), the header wraps, the toolbar becomes a stacked search-and-sort flow, and provider/network columns become a single column. Paired budget fields remain paired. Tables retain their comparison columns in a locally scrolling region with a minimum table width of (560px); the page itself should fit the viewport.

Explanations have bounded measure: section descriptions use up to (55ch), empty-state explanations up to (43ch), and inline setup guidance up to (80ch). Structural sections use separators rather than a hierarchy of nested cards.

## Elevation & Depth

There are no box shadows. Depth comes from warm page, white table, and ledger-paper surfaces, with thin borders and selected-row wash. The request ledger is a bounded task area, not a floating overlay. Focus uses a visible outline (3px) with an offset (3px).

**The Structural Depth Rule.** Use tonal surfaces and hairline registration to separate tasks; keep panels flat at rest and on hover.

State transitions are short: buttons transition background and border over (150ms). Pending markers pulse over (1s); refresh indicators rotate over (1.5s). Reduced-motion preferences disable animation and transitions.

## Shapes

Controls and response content use gently curved control corners; main table and ledger panels use the larger panel radius. Compact chips use the badge radius and small marks use the compact radius. Borders are generally (1px), with an active navigation underline (2px). Status marks are circles; functional icons are inline SVG line drawings.

## Components

### Buttons

Compact, confident controls distinguish the next consequential action.
- **Primary:** forest-green fill, white text, control radius, and a minimum height of (40px).
- **Secondary:** transparent fill, ink text, and a muted green-gray border; hover adds a pale wash.
- **Text action:** underlined green text for compact inline operations.
- **States:** explicit hover and keyboard focus; disabled controls use opacity (0.47) and an unavailable cursor. Smaller contextual controls use heights around (32–34px).

### Chips

Quiet state labels use a pale green fill, green text, a thin green-gray border, compact corners, and type (11px, weight 600). Their role is status, not promotional emphasis.

### Cards / Containers

The white marketplace table has a hairline border and panel corners. The request ledger and registry summary use Ledger Paper without a shadow. Ledger sections divide with muted hairlines. Default ledger padding is the frontmatter component value; roomy desktop uses (25px 28px) and compact widths use approximately (22–23px 20px).

### Inputs / Fields

Fields have explicit labels above white controls, a thin green-gray border, control corners, and minimum height (42px). Hint text sits immediately beneath. Textareas resize vertically and use generous line spacing (1.65). Search is a borderless input integrated into the table toolbar; sorting retains a bounded select affordance. Focus uses the shared green outline.

### Navigation

Providers and Consumers are the only two top-level tabs. Providers leads with a provider tile picker, grouped into nested API keys and OAuth tabs. Tiles show the connection method, truthful saved or connected status, and a specific add/connect action; they retain the paper surfaces and restrained green. OpenAI API-key addition is a password-only flow that saves one credential and loads official model metadata. Its account offers an exact supported catalog picker, a retry without re-entering the key, and per-model node configuration. Offer preparation leads to separate input/output test MON prices and explicit publication; manual node IDs live in a disclosure. Catalog visibility stays labeled as inference-unverified. Paid API-key accounts and personal plan connections remain distinct; Consumers uses a linear flow with Model and Provider dropdowns, then the request form. The model dropdown combines popular names with all exact listed IDs and shows truthful supplier counts or unchecked availability. Models with listed suppliers appear first. Advanced request options holds the output limit and unavailable private mode; providers are chosen manually; separate rates appear in the provider options and selected request, with a complete comparison in a disclosure. Exact IDs and full peer identities remain inspectable. Contract and network controls live in a shared Advanced settings disclosure accessible from the header and either tab. Provider node registration and local helper configuration use disclosures beside their tasks. Inactive items use muted ink; hover darkens the text; the active item uses green text and a green underline. The strip shares page gutters and remains horizontal on mobile, with smaller spacing and type. Wallet and network context occupy the header and wrap on mobile.

### Supplier Comparison and Request Ledger

Supplier rows keep model, provider, input price, and output price in stable columns. Selection is a pale row wash and opens context in the adjacent or following ledger. Functional row controls and external links use inline SVG icons.

The ledger displays identity, budget, phases, response, invoice, credit, and recovery context as needed. Pending and error messages remain visible near the task; completion is tied to a confirmed receipt. Empty states retain the same bounded surfaces and show genuine missing configuration or registry state.

## Do's and Don'ts

### Do:
- **Do** preserve separate input and output price columns, right-aligned tabular numerals, and explicit test MON units.
- **Do** make exact model identifiers and peer identities inspectable with the data type role.
- **Do** keep focus visible, fields explicitly labeled, and errors recoverable beside the affected task.
- **Do** use neutral surfaces, hairline separators, and green for action, selection, and confirmed state.
- **Do** preserve local table scrolling and stacked task flow on narrow screens.

### Don't:
- **Don't** present a pending transaction as complete before its confirmed receipt.
- **Don't** invent peers, prices, balances, activity, savings, or status to fill a surface.
- **Don't** replace the operating interface with a decorative hero or a generic chat landing page.
- **Don't** introduce nested cards or shadows where structural separators already express the task hierarchy.

The request inspector is a separate browser view at `/inspector`, opened beside Serving requests or a funded consumer request. It uses the same paper surface, type and green controls, with an explicit content-access boundary, read-only request lookup, public metadata list and unavailable telemetry state. It adds no primary navigation tab.
