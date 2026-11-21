# Boss encounters for Recess

Each rival gives the pilot a different reason to move. The same encounters run in the chat and in the offline practice flight. [Play the mockup](./recess-arsenal.html)

| Rival | First pattern | Rematch |
| --- | --- | --- |
| The Anglewright | **Concentric.** A pencil marks a circle before the compass inks its rim. The second stroke uses the same pivot and a different radius. | **Walking pivot.** The compass moves its pin before drawing the second circle. |
| Doublet | **Budding.** Two connected lobes pinch around a marked landing spot and dive in sequence. Move off the mark, then fly through the opening. | **Fission.** Both lobes dive together and separate. Their shots travel outward from the opening. |
| Offbeat | **Downbeat.** The pendulum points to the side that will receive the volley, then switches sides. | **Backbeat.** The arm holds for a silent beat, then returns to the first side. The lamps and marked columns also show the timing. |
| Carbon Copy | **Forward proof.** A printing press records three places the pilot has been, then stamps them in order. Overlapping impressions slip apart on visible tethers. | **Reverse proof.** The press strikes the newest mark first. Both the numbered field marks and the strip on the press show the order. |
| Limelight | **Still light.** A projector shines past a slide. Fly into the hatched shadow, then fire through the open lens as the projector reloads. | **Crosslight.** The lamp moves to a second position and the same slide casts a different shadow. Each warning shows where the cover will be when that lamp fires. |

| Opening rival | Subject packs |
| --- | --- |
| The Anglewright | Maths, business |
| Doublet | Biology, politics |
| Offbeat | Music, Spanish, French, Japanese |
| Carbon Copy | History, law, literature |
| Limelight | Chemistry, coding, finance |

Each subject rotates through all six opponents, including its version of the Wall of Text. On the second tour, each rival uses its rematch pattern at the same health. A named boss from the chat director opens its own rotation. The page remembers progress between flights, and picking a specific fight in the mockup leaves that progress intact.

## Mid-flight minibosses

After the first answer, the learner gets a breather and one short encounter. The same sequence runs after either answer. The next flight cycles to another miniboss. Each toy has four poses and a small health bar beside its body.

| Miniboss | What to watch | Where to fly |
| --- | --- | --- |
| Margin Clip | The binder clip lines its jaws up with the pilot and marks a horizontal path across the page. | Move above or below that line. The clip jams open at the far edge. |
| Pinwheel | Five spokes show the fan before pellets leave the hub. The second volley turns half a gap. | Choose a gap farther from the hub, then move again when the fan turns. |
| Pocket Magnet | Three metal washers wait at the far ends of the marked tracks. The arrows point back toward the magnet. | Cross a track before the washers slide in. The poles loosen after the pull. |

Clearing the miniboss drops a standard battery, worth 12 percentage points of firing charge before equipment bonuses and the full-charge limit. The flight log records its name. If it finishes three attacks, it leaves and refunds up to 3 points of charge. Either outcome leads back to the lesson. Only the finale releases the takeaway.

## What shaped the fights

- **Into the Breach.** Subset Games made the enemy's intended attack visible before the player commits. In Recess, the compass draws the exact strip it is about to ink. The space inside and the space outside are both usable. [Subset Games’ GDC design postmortem](https://media.gdcvault.com/gdc2019/presentations/Into%20the%20Breach%20Postmortem%20Final.pdf)
- **Furi.** The Game Bakers used quiet approaches to introduce opponents, and redesigned attack patterns for the harder setting. Recess borrows the change of pace for its short entrances and varies the pattern on a rematch. [The Game Bakers on designing Furi](https://www.thegamebakers.com/furi-and-creating-memorable-moments/)
- **Hi-Fi Rush.** Tango’s team built attacks and animation around the beat while keeping controls responsive between beats. Offbeat carries its warning in its arm and the playfield. Players can move and fire at any time with the game muted. [Tango Gameworks’ developer oral history](https://news.xbox.com/en-us/2023/10/04/hi-fi-rush-exclusive-oral-history/)
- **Balatro.** A Boss Blind changes a rule that affects how a hand is played. Here, Backbeat changes where the next volley lands after a rest. A player who has met Downbeat has something familiar to watch and one new decision to make. [Balatro’s official FAQ](https://www.playbalatro.com/faq)
- **Cuphead.** Studio MDHR described how a dash parry and a jump parry can suit different players in the same fight, and how much acting the team put into its boss entrances. In Recess, the second line of dialogue now triggers a character pose. Each new miniboss can also be resolved through firing or dodging. [Studio MDHR’s Xbox interview](https://news.xbox.com/en-us/podcast/overwatch-2-beta-new-cuphead-dlc-playing-xbox-on-samsung-tvs/)

Fable 5.2 caught a repeated idea during design. The original compass pitch used a gap in a falling row, a move the Wall already had. Its replacement uses a radius. Fable also suggested locking Doublet's target before the dive and giving Offbeat a visible pause.

## What changed in playtesting

Fable played all six early patterns in a 390-pixel Chromium window, steering with the mouse from the marks visible in screenshots. Stepping off the Anglewright's pencil marks avoided every ring hit in its two runs. Against Doublet, a parked pilot could win untouched, while a 70-pixel sidestep could cost a heart. The first lobe now lands on the spot Doublet marked when it pinched. The lobes then sweep outward, leaving a seam at least 118 pixels wide on a 320-pixel field. Fable also found that a pilot could park between Offbeat's columns. The opening volley now aims one marked column at the pilot.

Fable found that the practice shortcut could hand over after the first hit. “Fly this fight” now starts at the first warning, with the pilot and boss at full health. Replaying Fable's mouse controls on the revised phone layout, backing away from Doublet's marked landing kept all four hearts. On Offbeat's Backbeat, a pilot parked on the centreline lost two.

The Anglewright's and Offbeat's outer shells also intercepted shots aimed at their exposed joints. A shot that enters the shell on a path through the marked joint now earns triple damage. In both the toy and Ink styles, Offbeat exposes the winding key on its right while it rewinds. In a controlled 390-pixel arena, normal auto-aim landed all 240 recovery shots through that key at 84 pixels. At 295 pixels it landed 178 on Downbeat and 159 on Backbeat. These measurements used the same Pulse, shot count and starting aim phases at each distance.

In 24 seeded Chromium flights, two pilots faced the same six patterns at widths of 390 and 900 pixels with a power-three Pulse and two helpers. Both cleared all six patterns on both sizes without spending a bomb. The moving pilot kept all four hearts in every fight. The stationary pilot lost two hearts on Backbeat and one on each other pattern. These are automated balance measurements. Enjoyment still needs a student playtest.

Two complete flights also ran through the local chat interface. A calculus conversation fixture generated four questions and an explanation prompt, then the Anglewright appeared and the flight returned to the lesson recap. The biology demo reached Doublet after its two gates and kept the corrected misconception and takeaway in its recap.

Fable's next design pass flagged two problems with the new finales. A stationary pilot could stack all three impressions, and a projector sliding after its warning could change which space was safe. Carbon Copy now spreads an overlapping mark and draws it back to the sampled position. Limelight calculates the filled shadow from the lamp's destination. Shooting through the slide keeps the cover intact. Successfully avoiding a whole stamp sequence or light pattern wears the boss down and releases three charge sparks.

Fable then played all five new opponents in a 390-pixel Chromium window using screenshots and real controls. The numbered stamps were readable. Limelight's safe side was ambiguous, Pocket Magnet could pull a washer from under the controls, and the practice kit announcement covered the pilot at the first warning. The safe shadow now carries a **COVER** marker. The washers start above the controls with inward arrows. Practice hands over with the kit equipped and gives the player another 0.7 seconds to read the first warning. Using **Next** in a cutscene now holds the second line until the player chooses **Fight** or **Skip scene**.

During a Carbon Copy recovery, the centre of the exposed brass plate in its generated 256-pixel frame is at y = 134. The target in the flight and the Ink drawing use that position. Limelight exposes the glass at the front of its case. In both fights a pilot can aim at the visible part through the outer shell.

In a repeat on the revised 390-pixel practice flight, a pilot steered by the visible shadow in screenshots finished both **Still light** and **Crosslight** with all four hearts. The two parked controls finished with two hearts each. The test used ordinary pointer movement and left the combat state untouched.

After the first and second attacks, the miniboss's gauge falls to at most two-thirds and one-third. In twelve automated 390-pixel trials with pulse or charged scatter, fights took 4.92–6.64 seconds. All six pilots who followed the warnings kept every heart. Parked pilots lost one or two. Empty-charge pilots could dodge three attacks and collect the three-point refill after 9.50–10.70 seconds.

Four full Chromium runs used the chat's flight and recap. An incorrect first History answer led through Margin Clip, another question and Carbon Copy. In Chemistry, one flight defeated Pocket Magnet and another aimed away until it withdrew. Both reached Limelight. The withdrawal granted three points of charge and the recap credited only the actual knockout. A chain-rule chat reached Pinwheel, its four questions, the written explanation, and the Anglewright finale. These runs used local lesson fixtures and an automated pilot.

## Artwork

The built-in ImageGen tool generated eight four-pose actors. Each runtime WebP has a transparent 512 × 512 atlas. The four 256 × 256 cells run left to right, top to bottom, in the order ready, warning, attack, recovery. The chat portrait and the fight draw the same character.

[Pose sheet](./recess-boss-poses.webp) · [The Anglewright](../../../web/src/components/recess/art/boss-compass.webp) · [Doublet](../../../web/src/components/recess/art/boss-cell.webp) · [Offbeat](../../../web/src/components/recess/art/boss-metronome.webp)

[Two finales and three minibosses, all 20 poses](./recess-miniboss-wave.webp) · [Carbon Copy](../../../web/src/components/recess/art/boss-carbon.webp) · [Limelight](../../../web/src/components/recess/art/boss-projector.webp) · [Margin Clip](../../../web/src/components/recess/art/boss-clip.webp) · [Pinwheel](../../../web/src/components/recess/art/boss-pinwheel.webp) · [Pocket Magnet](../../../web/src/components/recess/art/boss-magnet.webp)

<details>
<summary>ImageGen prompts for the original three rivals</summary>

Each request used the common direction below followed by its character direction. Transparent background was enabled for each generation.

```text
Use case: stylized-concept. A production sprite sheet for the Keating Recess classroom arcade game. Make one SQUARE sheet on genuinely transparent alpha, containing exactly four complete poses of ONE original character in a precise two-by-two grid, equal square quadrants. Each character entirely inside its own quadrant with 10% clear padding on every side. Same scale and camera angle and centered footing between poses. Orthographic, straight-on front, appealing hand-built stop-motion toy, softly molded matte clay, painted wooden edges, muted saturated color, simple beady expressive eyes and emphatic brows. Broad readable silhouette at 72 pixels, soft light from upper left. Make these look like four photographed practical puppets against clear alpha. No text, numbers, diagrams, borders, colored panels, extra props, motion lines, cast shadows on a backdrop, or checkerboard. All four cells occupied, generous transparent gutters.
```

**The Anglewright**

```text
The Anglewright, a mischievous vintage drafting compass come to life. Entire silhouette is an unmistakable inverted V, with one short blunt dark stylus and one brick-red wooden pencil leg, a large honey-brass circular hinge and chunky knurled brass adjusting wheel with an expressive face on its cap. Dark petrol enamel and cream paint details. Legs are substantial and the point is rounded, like a classroom drawing toy. No humanoid torso behind the compass. Top left: confident neutral stance, legs apart and hinge faces camera. Top right: braces the stylus, curls pencil leg inward and squints to measure. Bottom left: pencil leg swings wide while pivot stays planted, looking in its direction, maintain same scale. Bottom right: springs open slightly, tipped back, surprised expression with brass hinge exposed. The poses should read as four different actions of the same handmade compass. Do not draw arcs, a ruler or a second character.
```

**Doublet**

```text
Doublet, a cheeky cell-division desk toy. A SINGLE joined horizontal pair of plump opaque turquoise soft vinyl or clay lobes with a tapered elastic waist, mint scalloped membrane rim, one warm apricot button-nucleus inset into each lobe. Two inset charcoal eyes total, one per side, can glance together. A few oversize sea-green bumps, tactile matte surface. The pair always has exactly TWO lobes and two nuclei, legless, no additional cells. Top left: squat rounded peanut silhouette, relaxed expression. Top right: narrow waist pinches hard, lobes rise, eyes look inward as if winding up. Bottom left: the pair stretches sideways leaving an easily visible central notch with a very thin connecting strand while nuclei face out; keep entire shape within its square. Bottom right: pair sags back together, lowered scallops and exposed apricot nucleus buttons, sheepish expression. Consistent colors, proportions and frontal camera across all cells. This is a whimsical classroom desk toy, not microscopy.
```

**Offbeat**

```text
Offbeat, a small mischievous mechanical metronome with a tall plum-red stained wooden pyramid-shaped case, cream instrument face, a single strongly visible honey-brass swinging pendulum arm and sliding square weight, black bead eyes with arched expressive brows, a large brass wind-up key in its right side and two stubby dark feet. A classic analog metronome, no clock dial, no musical notes or printed scale. Top left: upright composition, arm vertical, attentive expression. Top right: arm poised and held hard to its left, eyebrows pull toward that side. Bottom left: arm fully swung toward its right, body leaned into its tick, decisive expression. Bottom right: the arm hangs downward or droops diagonally, case leans tiredly away from its very visible brass key, eyelids low, a clear resting silhouette. Keep same scale, shape, and recognizable key in every cell.
```

</details>

<details>
<summary>ImageGen prompts for the two finales and three minibosses</summary>

Each of these five directions used the same four-pose layout and transparent background.

```text
Generate a square production sprite sheet with genuine transparent alpha for Keating Recess, a playful classroom arcade game. A precise 2×2 grid. Exactly four poses of ONE consistently identifiable anthropomorphic object, each fully inside its own equal-sized square with a full 10% transparent margin on every side. Same camera, scale and ground line across frames. Front-facing, orthographic hand-painted wooden and matte clay practical puppet. Bead eyes or a pair of small expressive eyes inset, tactile worn enamel edges, broad simple silhouette readable at fifty pixels, soft upper-left studio light. Bright warm classroom colors, neutral space is transparent. No pedestal, background, checkerboard, printed letters, numerals, captions, borders, extra objects, cast shadow outside the object or stray particles. Do NOT draw gameplay effects. The same actor in all quadrants. Top left ready, top right warning, bottom left action, bottom right recovery. Center the object in every quadrant.
```

**Carbon Copy**

```text
Carbon Copy is a squat indigo and periwinkle tabletop spirit duplicator, akin to an antique wooden printing press: wide rectangular plinth, chunky arched housing on top, ivory paper stack, one thick horizontal front roller and a little warm copper crank attached on its right. Two small ink-black eyes set into a cream enamel brow above the opening. Hero silhouette like a hunched printing press, not a robot, no limbs. The exposed brass press plate is centered across the front just below the actor's midline. Ready with roller visible. Warning lifts the upper housing leaving a visible gap above blank paper. Action clamps down hard with crank thrust out. Recovery opens widely and exposes the shiny centered plate, a short folded sheet droops forward. No symbols, marks or numbers on the paper. All four poses are equally substantial and fully visible.
```

**Limelight**

```text
Limelight is a small mustard-yellow and deep petrol blue 1950s classroom slide projector come to life. A boxy teal metal case with a single very large circular amber-glass FRONT lens centered slightly below mid-height, ribbed focus collar, a small mustard slide carousel on top, and two little charcoal feet. Two inset eye beads on the brow, the lens itself is not an eyeball. Near front-on symmetrical camera keeps the lens in exactly the same place in every pose. Ready: relaxed glass, dusty golden rim. Warning: shutters squeeze toward center and a slide lifts partway. Action: shutters wide and amber iris glows softly but stays opaque inside the lens; NO beam. Recovery: lid tips back, centered lens in a fully open bright golden rim is clearly exposed. Glass reflections inside actor only, approachable soft wooden toy photographed like stop-motion.
```

**Margin Clip**

```text
Margin Clip is an animated old-fashioned BINDER CLIP: one squat dark teal folded spring-steel wedge with two big rounded bent copper WIRE HANDLES clearly visible above the body, one cream painted mouth edge, a tiny pair of eyes on the clip body. Chunky graphic silhouette, the two handles should read even at 42 px. Front three-quarter just enough to see the hollow jaws, same attitude and orientation. Ready: handles raised, jaws closed. Warning: wire loops squeeze toward each other, jaws pry open. Action: body lunges sideward, one jaw stretched into a clear snapping shape. Recovery: handles flop outward and the jammed jaws hang open. No animal body, legs, teeth or monsters. Make it unmistakably a cute piece of stationery.
```

**Pinwheel**

```text
Pinwheel is a single four-bladed folded-paper wind spinner, a little desk toy with saturated ochre-yellow, terracotta, muted jade and coral sails, one enormous ivory/brass central button with two black bead eyes, lower short russet stick held by a simple wooden toy foot. Four broad triangular folded vanes around a single brass hub, clear red and cream underside folds. Always FOUR vanes, no fifth or more. Straight-on front face to camera, body centered at consistent size, no props, fun flat folded-paper planes and softly worn painted wood. Ready: vanes balanced. Warning: vanes cup inward like four spoons storing air. Action: all four stretched outward and curled at the tips in the same direction, rotated a little, crisp separate silhouettes, no blur or speed lines. Recovery: vanes sag asymmetrically, pin face looks tired, foot still steady.
```

**Pocket Magnet**

```text
Pocket Magnet is a single cherry-red enamel HORSESHOE MAGNET puppet, a thick upside-down U with two large squared silver steel pole tips pointing downward, ivory edge scuffs, a raised cheerful pair of beady eyes at the top of the arch and one little mustard-colored brass keeper across the front. It has NO body, legs, hands, paperclips, filings, debris or letters. The same bold red arch and two steel toes occupy every quadrant. Ready open inverted U with widely separated poles. Warning tips tilt inward and the little brow furrows. Action opens into a wide stance tilting forward a little, bright steel pads pointed toward the viewer. Recovery relaxes back crooked with one pole tipped outward and keeper loosely spanning part of the gap. A tactile metal desk magnet painted like a classroom toy.
```

</details>
