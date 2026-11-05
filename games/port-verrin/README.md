# Port Verrin

An original open-city crime and hustle game that runs in the browser. Walk and
drive around a procedural harbour city, grow a banned glowing swamp fungus in
your yard, pack it into tins, deliver it to customers across four districts,
hire runners, grow your turf and keep the Precinct 9 cruisers off your back.

Everything is original: the city, the districts, the characters, the product,
the look and the sound are all made in code. No paid assets, no accounts, no
API keys. The only dependency is [three.js](https://threejs.org) (MIT), vendored
in `vendor/` so it works offline. People use the free animated soldier rig
that ships with the three.js examples (`assets/Soldier.glb`, originally from
Mixamo), tinted per role, with punches, swings and aiming layered on in code.

## Play

From this folder, start any static file server and open the page:

```bash
cd games/port-verrin
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` straight from disk will not work, because browsers block
ES modules on `file://` URLs.)

Desktop browser with keyboard and mouse. Your progress saves in the browser.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move or drive |
| Mouse | Look around (click the screen to lock the mouse) |
| Shift | Sprint |
| Space | Handbrake |
| E | Interact, get in or out of a car |
| Tab | Burner phone: orders, runners, turf, help |
| Right mouse | Aim (over the shoulder) |
| Left mouse | Punch, swing or shoot |
| 1 to 5 / wheel | Fists, bat, pistol, SMG, shotgun |
| R | Reload |
| H | Horn |
| Esc | Close menus |

## How it plays

1. **Grow.** Your yard in Saltmarsh Docks has grow trays. Plant spore packs,
   wait for the caps to glow, harvest them.
2. **Pack.** Turn raw caps into Lumen tins at the workbench (needs empty tins).
3. **Sell.** Customers text you orders. Find the purple marker and hand over
   the tins. Copperline pays the most but has the most cruisers.
4. **Restock.** Buy spores, tins, fertilizer, extra trays and a bench upgrade
   at Fern & Spore in Old Kiln.
5. **Turf.** Every sale grows your turf in that district, which raises prices.
   At 20% turf a runner offers to sell for you there. Keep them stocked.
6. **Heat.** Deals, car theft, crashes and hitting pedestrians add heat. Above
   40 heat, a cruiser that keeps you in sight starts a chase. Break line of
   sight until the blue bar fills, or hide in your yard. If a cruiser pins you
   down while you are slow, you get collared and lose your product and some cash.

7. **Fight.** Marlow's Pawn (orange marker, Docks) sells a bat, a pistol, an
   SMG, a shotgun, ammo, body armour and medkits. Brine Rats gang members hold
   corners in the Docks and Vesper Heights and fight back; dropping them pays
   cash and turf. At two or more wanted dots, officers get out of their
   cruisers and shoot. Damaged cars smoke, catch fire and explode.

The final goal is 60% turf in all four districts.

## Districts

- **Saltmarsh Docks**: warehouses, container stacks, cranes. Your yard is here.
- **Old Kiln**: brick lofts and chimneys. Fern & Spore is here.
- **Copperline**: glass towers downtown. Best prices, Precinct 9 next door.
- **Vesper Heights**: houses with gable roofs and lawns.

## Code map

| File | What it does |
| --- | --- |
| `src/main.js` | Boot, player, camera, input, day and night, main loop |
| `src/city.js` | Road grid, districts, merged building mesh, colliders, ground texture |
| `src/actors.js` | Characters, cars, car physics, traffic and pursuit AI, pedestrians |
| `src/economy.js` | Trays, workbench, shop, orders, runners, turf, goals, saving |
| `src/police.js` | Heat, wanted level, cruiser spawning, line of sight, evading, getting collared |
| `src/render.js` | Physical sky, sky reflections, bloom, tone mapping, anti-aliasing |
| `src/characters.js` | Animated people, procedural punch, swing, aim, hit and death poses, weapon models |
| `src/combat.js` | Weapons, bullets, hit testing, muzzle flashes, tracers, blood, sparks, fire, explosions |
| `src/npcs.js` | Civilians who flee or fight, gang members, officers on foot |
| `src/hud.js` | HUD, minimap, shop and phone panels |
| `src/audio.js` | Synthesized engine, siren and UI sounds (WebAudio, no files) |

## Ideas for next steps

Interiors for the yard and shop, more product types and quality grades,
rival crews contesting turf, on-foot police, a radio, gamepad and touch
controls, and a bigger map with a bridge to a second island.
