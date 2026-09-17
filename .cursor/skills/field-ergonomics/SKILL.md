---
name: field-ergonomics
description: Physical-use constraints for any UI under app/(field) — outdoor sunlight readability, wet or cold thumb operation, one-handed grip, and no-hover interaction. Use this whenever building, reviewing or resizing ANY component in app/(field) or components/field/, not just Stage 8: outcome buttons, the map, the tab bar, sheets, toasts, form fields. Trigger on "field UI", "canvasser screen", "doorstep", "one-handed", "outdoor", or any button/layout/spacing decision inside the field route group. This is NOT a general design or theming skill — it does not cover colour palette choice, typography voice, or branding; see outcome-mapping for what colours MEAN and frontend-design (if loaded) for how things look. This skill governs whether they can be operated at all standing on a doorstep in the rain.
---

# Field ergonomics

Everything under `app/(field)` is used standing on a doorstep, in weather, with
one hand, often mid-conversation with a resident. The device may be gripped
awkwardly, the thumb may be wet or cold, and the screen may be in direct
sunlight. None of that is true of `app/(admin)` or `app/(office)`, which are
used seated, indoors, with two hands and full attention.

**This skill governs whether a control can be reliably tapped, read and
distinguished by touch and glance alone under those conditions — not how it
looks.** A field component can pass every accessibility and design review and
still fail on a real street. That failure mode is what this exists to catch.

If a field spec (like Stage 8's outcome buttons) already gives exact sizes,
order, and colours, those numbers win — this skill explains the reasoning
behind them and fills in anything the spec left unstated. Don't second-guess a
number a stage spec already fixed; apply this skill to what it left open.

---

## 1. Outdoor sunlight readability

Indoor contrast standards are not enough. WCAG AA's 4.5:1 minimum assumes an
office screen. Direct sun on a phone can wash out anything below roughly
**7:1** for primary actions and body text a canvasser must actually read
(door numbers, street names, outcome labels).

- Primary action text/icon against its button fill: **7:1 minimum**, not 4.5:1.
- Never rely on a light tint or a pastel fill to carry an active state — it
  disappears in glare. Use solid fill, not outline-only buttons; an outlined
  button's border can vanish entirely in bright light.
- Test assumption: if a colour choice only reads correctly on a colour-managed
  laptop screen at indoor brightness, it will fail in the field. When in
  doubt, go darker/more saturated, not lighter.
- Never encode state by colour alone. Pair every colour with an icon, a fill
  shape, or a label — this is both an accessibility requirement and a
  glare-survival requirement, because colour discrimination itself degrades in
  bright light before shape recognition does.

## 2. Thumb-zone geometry (one-handed grip)

A canvasser is holding the phone in one hand, thumb doing the tapping, no
second hand free (clipboard, umbrella, door). Reachability is not uniform
across the screen.

On a typical field phone held one-handed, treat the screen in three bands:

- **Bottom third** — easy reach, no grip adjustment. Put the highest-frequency
  action here.
- **Middle third** — reachable with a slight grip shift. Fine for secondary
  actions.
- **Top third** — requires a grip change or a second hand. Never put a
  frequently-tapped control here. Acceptable for rare, deliberate actions
  (settings, sign out) or for something the canvasser should have to reach
  for on purpose, as a natural friction/confirmation.

**Order controls by tap frequency, not by visual hierarchy convention.** The
most-tapped action goes lowest and largest; the rarest goes highest and
smallest. This sometimes inverts normal UI convention (primary action at top)
— that convention assumes two-handed, seated use, which this context isn't.

Deliberately place a **destructive or unrecoverable** action (anything the
canvasser cannot undo themselves) away from the highest-frequency zone, even
if it means a slightly longer reach for that action. A harder reach is a
built-in guard against a mis-tap on something that matters.

## 3. Touch targets — size AND spacing

44px minimum touch target applies everywhere already (see AGENTS.md). That
alone is not sufficient for wet-thumb use.

- **Minimum 8px gap between adjacent targets**, not just 44px per target. A
  wet or cold thumb has a larger effective contact patch than a dry one, and
  without a real gap it clips the neighbouring button.
- The highest-frequency target should be the largest on screen, not merely
  meeting the 44px floor. Scale target size to expected tap frequency.
- Never place two different outcomes edge-to-edge with no visual gap, even if
  each individually clears 44px.

## 4. No hover-dependent state

There is no hover on a touchscreen, and a wet or gloved thumb makes even
press-and-hold unreliable. Any interaction that depends on:

- a hover preview
- a long-press to reveal an action
- a tooltip that only appears on hover

...does not work in the field. Every piece of information the canvasser needs
must be visible in the resting state, not revealed by an interaction that
outdoor/wet conditions can't reliably trigger.

## 5. Confirm state through more than one channel

A visual-only state change (a button changing colour, a dot filling in) can
be missed — bright sun, glancing down mid-conversation, wet screen distorting
the display.

- Pair every state-confirming visual change with a **haptic** pulse
  (`navigator.vibrate(...)`) where the platform supports it.
- Never make an irreversible action's confirmation purely visual with no other
  signal.
- Do not animate the confirmation in a way that could be mistaken for
  responding to an accidental tap — motion on a wet or glare-affected screen
  reads ambiguously. A brief, snappy state change plus haptic beats a
  lingering animated transition.

## 6. Input debounce

Cold or wet fingers mis-register taps more than dry ones, and a resident-facing
canvasser is often not looking directly at the screen when they tap. Any
action with a real consequence (a database write, an irreversible state
change) needs a short lockout after firing — roughly 300–500ms — so a
double-tap cannot fire the action twice. This is separate from any deliberate
"tap to confirm" step; it exists purely to eat unintended repeat input, not to
add a confirmation the interaction otherwise doesn't need.

## 7. Testing protocol

A field component is not verified by a design review or a desktop browser
resize. Before marking any field UI acceptance item as passed:

- [ ] Tested on a real phone, one-handed, thumb only, no second hand assisting.
- [ ] Tested at arm's length in direct sunlight or the closest achievable
      approximation (a bright window, a phone's outdoor brightness boost).
- [ ] Tested with a wet or damp fingertip, not a dry one.
- [ ] Every control that confirms a state change does so visually AND via
      haptic, verified on-device (haptics don't show up in a simulator).
- [ ] No control depended on hover, long-press-to-reveal, or a tooltip to
      convey required information.

A screenshot or a simulator pass is not sufficient evidence for these items.