# Zero Mess Keymapper

A browser-based visual editor for ZMK firmware keymaps.
No installation — a single HTML file — with **automatic conversion of US-layout keymaps for JIS environments**.

The name is a backronym of **ZMK**: it aims to bring the *mess* of keyboard layouts down to *zero*.

👉 **[Open the editor](https://ToyoKoji.github.io/Zero_Mess_Keymapper/)**

[日本語版 README](./README.md)

---

## What is this for?

ZMK keymaps are written in `.keymap` text files. Designing symbol placement, or keeping track of what lives on which layer, is hard to do in plain text. This tool lets you click on a picture of your actual keyboard to build the layout, then export it as a `.keymap` file.

### It solves the "symbols move around" problem

ZMK sends the *position* of a key; the operating system decides which character that becomes. So a keymap designed for a US layout falls apart the moment the OS is set to Japanese (JIS) — pressing what should be `@` produces `"`, and so on.

**US⇄JIS conversion** rewrites your US-side layout into keycodes that produce the same visible characters on a JIS-configured OS, and stores the result as a separate layer group. Keys whose symbol depends on Shift (`'` and `"`, for example) are handled by automatically generating mod-morph behaviors.

### It also matches the feel across operating systems

**Win⇄Mac conversion** swaps shortcuts and IME keys between Windows and macOS conventions — `Ctrl+C` ⇄ `Cmd+C`, `Home` ⇄ `Cmd+←`, Henkan/Muhenkan ⇄ Kana/Eisu — so your fingers do the same thing on either machine.

### One design, every environment

The idea at the centre of this tool is the **environment**:

```
environment = keyboard layout (the OS setting) × operating system
```

For example "work PC = JIS × Windows", "home Mac = US × macOS", "iPad = US × iOS".

You group layers by environment, design **one of them as the base**, and generate the rest with **environment sync**. On the keyboard itself you switch environments with a key on a shared layer, so **your fingers do the same thing on every machine**.

Supported layouts are US (ANSI), JIS, UK (ISO), German (QWERTZ) and Dvorak; supported systems are Windows and macOS.

---

## Features

**Layout editing**

- Click keys on a rendering of your actual keyboard
- Keys show **the character that will actually be typed**, based on the layer's layout standard
- Drag and drop to swap or copy, undo/redo (Ctrl+Z)

**Layers by environment**

- Organise layers into environments (layout × OS) and shared layers
- Reorder and colour-code them; layer numbers and all references follow automatically
- **Layer order check** — finds problems caused by ZMK's layer priority rules and fixes them in one click

**ZMK features supported**

Combo / Mod-Morph / Tap-Dance / Macro / Conditional Layer / custom Hold-Tap (including positional hold conditions for home-row mods) / global Hold-Tap and Sticky Key tuning / trackball (PMW3610)

**Helpers**

- Validation before export (references to missing layers, undefined behaviors)
- **OS compatibility check** — finds keycodes your operating systems ignore (`K_MUTE` and friends) and replaces them with working alternatives. Covers Windows, macOS, Linux, iOS and Android
- Full backup and restore as a single JSON file
- Printable cheat sheet
- Key tester, dark/light theme, Japanese/English interface
- GitHub integration — read and commit directly to your zmk-config repository

**Other keyboards**

Load any file containing a ZMK physical layout definition (`key_physical_attrs`) and the editor will render that keyboard.

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
index.html   the app (core layer = DOM-independent logic / UI layer)
tests.js     automated test suite
```

Run the tests:

```bash
node tests.js
```

The suite covers parse/generate round-trips, the correctness and reversibility of every conversion, the consistency of the OS compatibility table, and persistence of every feature — 165 checks in all. Run it after any change.

An architecture overview is in the comment block at the top of `index.html`.

---

## Licence

MIT

## Related

- [ZMK Firmware](https://zmk.dev/) — the target firmware
- [roBa](https://github.com/kumamuk-git/roBa) — the keyboard this project started from (a wireless split with a trackball)
