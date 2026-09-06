# Zero Mess Keymapper

A browser-based visual editor for ZMK firmware keymaps.
No installation — a single HTML file — with **automatic two-way conversion** of a keymap between layouts and operating systems (US⇄JIS, Windows⇄macOS, and so on).

The name is a backronym of **ZMK**: it aims to bring the *mess* of keyboard layouts down to *zero*.

👉 **[Open the editor](https://ToyoKoji.github.io/Zero_Mess_Keymapper/)**

[日本語版 README](./README.md)

---

## What is this for?

ZMK keymaps are written in `.keymap` text files. Designing symbol placement, or keeping track of what lives on which layer, is hard to do in plain text. This tool lets you click on a picture of your actual keyboard to build the layout, then export it as a `.keymap` file.

### It solves the "symbols move around" problem

ZMK sends the *position* of a key; the operating system decides which character that becomes. So a keymap designed for a US layout falls apart the moment the OS is set to Japanese (JIS) — pressing what should be `@` produces `"`, and so on.

**Layout conversion** rewrites a layout into keycodes that produce the same visible characters under a different layout, and stores the result as a separate layer group. It works **in both directions** — US to JIS and JIS to US alike — and between any pair of the supported layouts. Keys whose symbol depends on Shift (`'` and `"`, for example) are handled by automatically generating mod-morph behaviors.

### It also matches the feel across operating systems

**OS conversion** swaps shortcuts **both ways** between the Ctrl and Cmd conventions — `Ctrl+C` ⇄ `Cmd+C`, `Home` ⇄ `Cmd+←`, `Alt+Tab` ⇄ `⌘Tab` — so your fingers do the same thing on either machine. Modifier names follow the environment's OS as well: Alt / Win on Windows, ⌥ / ⌘ on macOS and iPadOS.

### One design, every environment

The idea at the centre of this tool is the **environment**:

```
environment = keyboard layout (the OS setting) × operating system
```

For example "work PC = JIS × Windows", "home Mac = US × macOS", "iPad = US × iOS".

You group layers by environment, design **one of them as the base**, and create the rest from **"+ Environment"** — pick a source and the converted layers appear straight away. After editing the base, **environment sync** brings the others back in line. On the keyboard itself a switch key moves between them, so **your fingers do the same thing on every machine**.

Supported layouts are **US (ANSI), JIS, UK (ISO) and German (QWERTZ)**; supported systems are Windows, macOS, Linux, iOS and Android.

Conversion is deliberately limited to national layouts — same QWERTY arrangement, different symbol positions and Shift behaviour. Alternative layouts such as Dvorak are out of scope: converting to one would not preserve the feel, which is the whole point.

Shortcuts really only come in two families — Ctrl-based (Windows, Linux, Android) and Cmd-based (macOS, iPadOS) — so conversion happens between those two. Within a family (Windows to Linux, say) nothing is converted; the remaining keycode differences are handled by the OS compatibility check.

**With a single environment none of this is shown** — it behaves as an ordinary keymap editor.

---

## Features

**Layout editing**

- Click keys on a rendering of your actual keyboard
- Keys show **the character that will actually be typed**, based on the environment's layout
- Modifier names follow the environment's OS too — Alt / Win on Windows, ⌥ / ⌘ on macOS and iPadOS
- Drag and drop to swap or copy, undo/redo (Ctrl+Z)

**Layers by environment**

- Organise layers by environment (layout × OS); either setting may be left unset
- Reorder and colour-code them; layer numbers and all references follow automatically
- **One-step environment creation** — name, layout, OS and source in a single dialog; the converted layers are created for you
- **Settings visible in the layer list** — each environment shows its layout and OS ("JIS × Windows"); click to change them in place
- **Switch keys** — place the keys that move between environments, optionally switching the Bluetooth profile too
- **Layer order check** — finds layers that would be ignored when called, and fixes the order in one click

**ZMK features supported**

Combo / Mod-Morph / Tap-Dance / Macro / Conditional Layer / custom Hold-Tap (including positional hold conditions for home-row mods) / global Hold-Tap and Sticky Key tuning / trackball (PMW3610)

**Helpers**

- Validation before export (references to missing layers, undefined behaviors)
- **OS compatibility check** — finds keycodes your operating systems ignore (`K_MUTE`, the Japanese IME keys, and so on) and replaces them with working alternatives. Covers Windows, macOS, Linux, iOS and Android
- **Per-environment combos, macros and tap-dances** — these are shared across environments, so one that types a symbol produces the wrong character under a different layout. The editor finds them and splits them per environment, rewriting the layers that referenced them
- Full backup and restore as a single JSON file
- Printable cheat sheet
- Dark/light theme, Japanese/English interface
- GitHub integration — read and commit directly to your zmk-config repository

**Other keyboards**

Common keyboards are built in — pick one under **☰ Menu → Keyboard**: **Corne 6-column (42, the default)**, roBa (43, with trackball), Osakana/Fish (32), Ferris Sweep (34), Corne 5-column (36), Lily58 (58), Sofle (60), and ortholinear grids (40 / 48 / 60, as on the Planck and Preonic).

**Anything else can be fetched from GitHub.** Point "Find layouts" at a repository and the editor collects every physical layout definition it finds. The default `zmkfirmware/zmk` yields **60+ layouts** — TKL, 60/65/75% in ANSI, ISO and HHKB variants, numpads, Kyria, Corne, Sofle and more. Your own zmk-config works just as well. Loading a local `.dtsi` / `.overlay` and generating a plain grid from a key count are still available.

**Key sizes are editable too** — 2U backspace, 6.25U spacebar and so on. Resizing shifts the rest of the row automatically and flags overlaps. Key assignments are never touched.

> The built-in coordinates come straight from the [physical layout definitions in the ZMK repository](https://github.com/zmkfirmware/zmk/tree/main/app/dts/layouts).

---

## Usage

### About `.keymap` files

A `.keymap` file is a **blueprint**, not something you can put on the keyboard directly. It has to be built on GitHub into a `.uf2` firmware file.

This tool handles the editing; GitHub Actions does the building (free and automatic). Compiling in the browser is not technically possible, so this division of labour is common to every ZMK editor.

### Basic flow

1. Open the editor (it starts with the roBa default layout)
2. **☰ Menu → Open** and load your own `.keymap`
3. Click keys to edit
4. **Export .keymap** (the next steps are shown on screen afterwards)
5. Replace `config/<name>.keymap` in your zmk-config repository and commit
6. GitHub Actions → the run → **Artifacts** at the bottom of the page → download firmware
7. Copy the `.uf2` from the zip onto the keyboard in bootloader mode

### Using GitHub integration (skips steps 4–5)

**☰ Menu → GitHub** lets you load and commit without leaving the browser.

Create a **fine-grained personal access token** first:

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
2. Under **Repository access**, select your zmk-config repository
3. Under **Repository permissions → Contents**, choose **Read and write**

> **About your token**
> The token is stored only in your own browser (and only if you tick the box), and is sent nowhere except the GitHub API. On a shared computer, leave "Save in this browser" unchecked.

---

## Compared with ZMK Studio

[ZMK Studio](https://zmk.studio/) is the official tool for changing a keymap over USB with no build step. For quick swaps it is more convenient.

However, Studio can only assign behaviors that are **already compiled into the firmware** — defining new ones is listed as "not planned" by ZMK.

The US⇄JIS conversion in this tool works precisely by defining new behaviors (auto-generated mod-morphs), so it cannot be reproduced in Studio. Combos, conditional layers and detailed macro settings are also unsupported there.

| | ZMK Studio | Zero Mess Keymapper |
|---|---|---|
| Build required | No (instant) | Yes (GitHub Actions) |
| Swapping keys | Yes | Yes |
| Defining new behaviors (mod-morph etc.) | No | Yes |
| US⇄JIS conversion | No | Yes |
| Combos / conditional layers | Not yet | Yes |
| Detailed macro settings | Not yet | Yes |

Use Studio for quick rearrangements; use this tool to design symbol placement, JIS support, combos and macros.

---

## Requirements

Recent versions of Chrome, Edge, Firefox or Safari. Your work is saved automatically in the browser (nothing is sent to a server).

---

## For developers

A single HTML file with no external dependencies.

```
index.html        the app (core layer = DOM-independent logic / UI layer)
tests.js          automated test suite
ui-tests.js       tests that actually drive the page (jsdom)
release-check.js  pre-release checks
```

Run the tests:

```bash
npm install jsdom        # needed for the page tests; they are skipped if absent
node tests.js            # 1841 checks (306 of them driving the page)
node release-check.js    # 162 checks on whether this is fit to ship
```

Make sure the summary at the end of `node tests.js` reports both groups. Without jsdom the page tests are **silently skipped** rather than failing.

`tests.js` checks the core layer and the HTML structure, then hands off to `ui-tests.js`, which loads the page and **clicks the actual buttons**.

Among other things it covers parse/generate round-trips, the reversibility of every conversion across all five layouts and every key, state persistence (catching anything left out of undo history, browser storage or backups), reference fix-ups when layers are copied/deleted/moved, the OS compatibility table against the official docs, resilience to malformed files, and structural invariants for the UI (every referenced id exists, no duplicates). Run it after any change.

An architecture overview is in the comment block at the top of `index.html`.

---

## Licence

MIT

## Related

- [ZMK Firmware](https://zmk.dev/) — the target firmware
- [roBa](https://github.com/kumamuk-git/roBa) — the keyboard this project started from (a wireless split with a trackball)
