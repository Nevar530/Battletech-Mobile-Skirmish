# BATTLETECH // Mobile Skirmish: MSS:84

[![Play on GitHub Pages](https://img.shields.io/badge/Play%20Now-GitHub%20Pages-brightgreen?style=for-the-badge)](https://nevar530.github.io/Battletech-Mobile-Skirmish/)

Take **BattleTech** anywhere.  
This is a browser-based **hex map skirmish terminal** built for tablets, laptops, and desktops — no maps, no dice, no login required. Just open and deploy.

---

## 🔗 Cross-App Integration  

Mobile Skirmish now links with **[TRS:80 // Technical Readout System:80](https://nevar530.github.io/TRS80/)**.

- Export Lance JSON from TRS:80  
- Import into MSS:84 to instantly spawn mechs with names, pilots, skills, and team colors  
- Team colors sync: Alpha, Bravo, Clan, Merc  
- Tokens spawn on grid with pre-filled record data  

🛰 *TRS:80 + MSS:84 = one complete digital force pipeline.*

And now, MSS:84 is fully standalone — no external builder required.

---

## ⚙️ Core Systems

- 🧭 **Hex Grid Engine**
  - Adjustable grid size, hex width, and unit scale
  - Paintable terrain, elevation, and cover layers
  - Preset battlemaps: river valleys, cities, ridgelines, craters

- 🤖 **Mech Token Engine**
  - Drop-in ’Mechs with names, pilots, teams, and BV auto-calculation
  - Rotate, resize, and drag tokens across the grid
  - Initiative tracker with turn order management

- 🔭 **LOS & Tactical Tools**
  - Toggle line-of-sight rays, fire arcs, and range overlays
  - Right-click rangefinder between any two tokens
  - Keyboard or touch-friendly controls

- 🛰 **Firebase Sync Uplink**
  - Remote sync mode with room code uplink
  - "Transmit" sends the full battle state to opponent like a walkie-talkie
  - No login or setup required — free tier, secure snapshot sync

- 📡 **Offline-Capable**
  - Runs entirely in-browser, even without internet
  - LocalStorage caching for map state, sheets, and last played data
  - Export/import battles as JSON, or snapshot board as PNG

- 📄 **Integrated Mech Sheets**
  - In-app dynamic record sheets per ’Mech
  - Track armor, internals, heat, pilot skills, ammo, and crits
  - Persistent and synced across turns or networked sessions

- 🎯 **GATOR Console (Gunnery, Attacker, Target, Obsticals, Result)**
  - Calculates 2d6 hit modifiers and target numbers
  - Simulates hit locations, crit confirmations, and missile cluster rolls
  - Perfect for remote play or fast digital resolution
  - Works offline and syncs cleanly between players

- 📊 **Flechs Sheets Dock (Optional)**
  - Embed external [Flechs Sheets](https://sheets.flechs.net) in side panels
  - P1/P2 dock layout for analog-style record keeping
  - Use instead of or alongside the in-app sheet system

---

## 🕹 How to Play

1. **Open the Live App**:  
   → [https://nevar530.github.io/Battletech-Mobile-Skirmish/](https://nevar530.github.io/Battletech-Mobile-Skirmish/)  
   *Runs best on desktop or tablet. Phones are not recommended.*

2. **Build your Map** (Left Panel)
   - Paint terrain types (grass, water, rough, etc.)
   - Add cover (woods, buildings)
   - Adjust height levels (hills, craters, water depth)
   - Load a preset battlefield or start blank

3. **Deploy your Mechs** (Right Panel)
   - Enter name, pilot, and team
   - Click “Add Mech” to place on the board
   - Use the roster to manage turn order, rotate, or remove

4. **Track Initiative & Turns**
   - Roll initiative, set custom order, and step through using “Next”

5. **Engage Combat**
   - Move, rotate, and attack using the built-in tools
   - Use the GATOR console for fast, fair resolution
   - Open in-app Mech Sheets to track damage, heat, and status

6. **Play Remote (Optional)**
   - Open **Uplink**, enter a shared room name (e.g. `tiger-ember-fox`)
   - Opponent joins with same phrase
   - Each player presses **Transmit** after their turn to sync the field
   - Use voice chat for best experience

---

## 🖼 Screenshots

### Main Map with Mechs & Terrain  
![Fullscreen Map](images/fullscreen.png)

### Side Panels: Mechs, Tools, GATOR  
![Menus](images/menus.png)

### Terrain Paint & Presets  
![Terrain Tools](images/tools.png)

### Flechs Sheets (Optional Dock)  
![Flechs Sheets](images/flechsheet.png)

> 📌 Add screenshots of:  
> - GATOR console (open + roll results)  
> - In-app Mech Sheet panel (with armor pips)  
> - Firebase sync status banner  
> - Large map with city terrain  

---

## 🧰 Developer Notes

- Written in: **HTML5 / CSS3 / Vanilla JavaScript**
- No dependencies, no build tools
- Modular `/modules/` structure
- JSON-driven mech database
- All rendering via SVG and canvas overlays

Runs on GitHub Pages or local. Forkable and extendable.

---

## 🛡 License & Attribution

**MSS:84** is a fan-made web application built to support the BattleTech community.

- Portions of data (unit stats, naming schema) were derived from the open-source [MegaMek](https://megamek.org) project.
- No proprietary art, audio, or Catalyst material is used.
- All code is MIT licensed.
- All gameplay data is CC-BY-NC-SA unless otherwise noted.
- Flechs Sheets by BisonAIs is embedded for convenience only.

> BattleTech®, BattleMech®, and related terms are trademarks of The Topps Company, Inc.  
> Catalyst Game Labs is the current license holder.  
> This tool is not affiliated with or endorsed by Topps, Catalyst, Microsoft, or MegaMek.

---

## 🙏 Credits

- **Lead Design & Direction**: [nevar530](https://github.com/nevar530)  
- **Code Engine Assistance**: ChatGPT (OpenAI), under direct instruction  
- **Sheet Dock Integration**: [Flechs Sheets](https://sheets.flechs.net) by BisonAIs  
- **Playtesting & UX Iteration**: Battle-hardened volunteers

> Inspired by paper maps, coffee-stained record sheets, and 30 years of scorched hexes.

---

## 📚 Documentation & Wiki

→ [Visit the Wiki →](https://github.com/Nevar530/Battletech-Mobile-Skirmish/wiki)  
Includes guides, hotkeys, sync setup, and advanced tools.

---
