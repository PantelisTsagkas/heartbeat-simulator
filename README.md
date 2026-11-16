# Heartbeat Simulator

**Status: ACTIVE**

Explore the rhythm of the human heart. An interactive, educational web app with an animated anatomical heart, an ECG-style trace and a synthesised heartbeat, all driven by one BPM value.

This is an educational illustration. It is not a medical device and does not measure, monitor or diagnose anything. Real resting heart rates and exercise responses vary between individuals, and a BPM number alone does not say whether a heart is healthy.

## Features

- A textbook-style cutaway of the heart, seen from the front, drawn in SVG. It shows the four chambers (right and left atria, right and left ventricles), the septum, all four valves, the superior and inferior venae cavae, the pulmonary artery with its left and right branches, the four pulmonary veins and the aorta with its arch.
- A real contraction sequence, not a uniform scale: the atria squeeze first, then the ventricle cavities shrink while their walls thicken. The tricuspid and mitral valves open while the ventricles fill and shut while they contract; the pulmonary and aortic valves do the opposite.
- Blood shown as moving particles along the real pathways. Systemic circulation: left ventricle, aorta, body, venae cavae, right atrium. Pulmonary circulation: right ventricle, pulmonary artery, lungs, pulmonary veins, left atrium. Blue is oxygen-poor, warm is oxygen-rich. Where a vessel passes behind another structure its particles are hidden, so blood never appears in the wrong vessel.
- Heart rate slider from 30 to 200 BPM (default 72) and five presets: 60, 72, 100, 140, 180.
- ECG-style trace on a fixed time axis, so a higher BPM pulls the peaks closer together. Beats already drawn stay where they were.
- Play / pause, and an optional "lub-dub" sound generated with the Web Audio API. No audio files. Audio starts only after you turn it on, and the app works without it.
- Plain-language notes on BPM, systole, diastole and exercise.
- English and Greek. The app follows the browser language on first visit and remembers the choice made with the EN / ΕΛ switch.
- Keyboard-friendly native controls with labels, and a reduced-motion mode.

## Run it

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Other scripts:

```bash
npm run build   # production build
npm run start   # serve the production build
npm run lint    # ESLint
```

## How it works

BPM lives in one piece of React state. A single `requestAnimationFrame` loop (`src/lib/beatClock.ts`) accumulates beat phase each frame:

```
phase += dt * bpm / 60000      // one full cycle takes 60000 / bpm ms
```

Because phase is accumulated instead of derived from wall time, moving the slider changes the speed without making the animation jump. The shape of a beat (when each event falls inside it) is latched at the start of that beat, so a rate change mid-beat never snaps the pose or double-fires a spike. The heart, the trace and the sound all subscribe to that one clock and write straight to the DOM, canvas or audio graph, so nothing re-renders per frame. Pausing stops the clock, which freezes all three together.

`src/lib/cardiac.ts` turns a BPM into the timing of events inside a beat. Systole stays roughly constant in milliseconds while diastole absorbs most of the change, which is why 30 BPM looks like a quick beat followed by a long pause instead of a slow-motion squeeze. This is a simplified visual model, not physiology.

The illustration is schematic. A real heart cannot show all four chambers, all four valves and every great vessel in one flat slice, so structures at different depths are drawn together, as in most teaching diagrams. The connections between them follow standard cardiac anatomy. It has not been reviewed by a clinician or medical illustrator.

## Structure

```
src/
  app/                  layout, page, global styles
  components/
    HeartbeatSimulator  page shell, owns BPM and play state
    HeartVisual         SVG heart, animated from the clock
    BloodFlow           canvas overlay of blood particles
    EcgCanvas           sweep-style trace on a canvas
    PhaseIndicator      systole / diastole lights
    Controls            slider, presets, play / pause, sound, volume
    InfoSection         educational notes
  hooks/
    useBeatClock        lifecycle of the shared clock
    useHeartSound       Web Audio lub-dub
    useLocale           current language, persisted in localStorage
  lib/
    beatClock           the requestAnimationFrame loop
    bloodFlow           particle routes through the heart
    cardiac             timing model, ECG shape, presets, rate bands
    i18n                English and Greek text
```

## Stack

Next.js (App Router), React, TypeScript, Tailwind CSS, Lucide icons. No backend, no other runtime dependencies.
