<!-- Model-facing schema for `Anatomy3D`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/lanes/anatomy3d/CATALOGUE-DELTA.md. -->

## `Anatomy3D` (kind `anatomy`): a schematic 3D anatomy model

Write it in an openui fence as `Anatomy3D(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Educational model only.** The geometry is procedural, schematic and not to scale; the canvas says so and the receipt says it is not for clinical use. Never present it as a patient's anatomy, never use it to read or judge a real scan, and never give clinical advice from it.

**Teaches:** spatial relations: what lies in front of what, which chamber empties through which valve, which vessel runs in which groove, what an axial slice at a vertebral level shows. The learner orbits the model (drag empty space), pulls a structure aside to see behind it (it snaps back), drags name chips onto structures or numbered pins (`label`), drags the clipping plane to read a linked CT-style axial slice, viewed from the feet with the patient's right on the left (`section`), or moves a drop of blood one chamber or valve at a time (`trace`; a wrong turn is explained, and after two misses the next step is named). Without WebGL it falls back to a flat anterior view where every mode still works.

**Choose it for:** "I keep mixing up the heart's chambers and valves, quiz me" (`heart`, `label`); "What order does blood go through the heart?" (`heart`, `trace`); "Which coronary artery is which / what does the LAD supply?" (`heart`, `label` with coronary targets); "What does a CT slice at T4 show?" (`thoracicCrossSection`, `section`); "Why is the left atrium seen so well on TOE?" (`heart`, `explore`, `targets: ["leftAtrium"]`); "Where does the azygos drain?" (`thoracicCrossSection`, `trace`).

**Not for:** any structure outside the two models below (brain, abdomen, limbs, nephron, plexuses): prose. Histology, physiology curves (pressure–volume loops, ECG), pathology or congenital defects: the model is the normal adult heart, with no patent foramen ovale or VSD. Patient images, real sizes or "is this CT normal?". A purely verbal function question ("what do the chordae tendineae do?"): prose.

**Config** (`Anatomy3DConfig`; unknown fields are rejected):

| field | type | required | rule |
|---|---|---|---|
| `model` | `"heart"` \| `"thoracicCrossSection"` | yes | |
| `mode` | `"explore"` \| `"label"` \| `"section"` \| `"trace"` | yes | |
| `targets` | structure ids | `label`: 2–10. `section`: optional, 1–8. `explore`: optional, 1–8 (highlighted). `trace`: not allowed. | Unique ids of the chosen model. With `section` + `level`, every target must appear in the slice at that level. |
| `route` | structure ids | `trace` only, 2–16 | Each consecutive pair must be a flow edge below. |
| `level` | `"T1"` … `"T12"` | `section` only, optional | Names unlock when the plane reaches it. Heart: T3–T9; thorax: T1–T12. |
| `question` | string ≤ 200 | optional | Shown above the canvas. |
| `title` | string ≤ 60 | optional | Defaults by mode. |

**Structure ids, `heart`:** `superiorVenaCava`, `inferiorVenaCava`, `rightAtrium`, `tricuspidValve`, `rightVentricle`, `pulmonaryValve`, `pulmonaryTrunk`, `pulmonaryArteries`, `pulmonaryVeins`, `leftAtrium`, `mitralValve`, `leftVentricle`, `aorticValve`, `aorta`, `rightCoronaryArtery`, `leftCoronaryArtery`, `leftAnteriorDescending`, `circumflexArtery`.

**`thoracicCrossSection`:** all the heart ids (aorta continued to the hiatus at T12, IVC from the diaphragm), plus `trachea` (with the main bronchi), `esophagus`, `azygosVein`, `vertebrae`, `sternum`, `rightLung`, `leftLung`.

**Flow edges** (for `route`): superiorVenaCava → rightAtrium; inferiorVenaCava → rightAtrium; rightAtrium → tricuspidValve → rightVentricle → pulmonaryValve → pulmonaryTrunk → pulmonaryArteries → pulmonaryVeins (through the lungs, noted rather than drawn) → leftAtrium → mitralValve → leftVentricle → aorticValve → aorta; aorta → rightCoronaryArtery; aorta → leftCoronaryArtery → leftAnteriorDescending; leftCoronaryArtery → circumflexArtery; thorax only: azygosVein → superiorVenaCava.

The share describes only what the learner did (placed names, each wrong drop and what it hit, the path and wrong turns, the plane level) and names common confusions (mitral/tricuspid, pulmonary/aortic, right/left chambers). The label quiz never reveals a hovered structure's name.

**Examples:**

```openui lifecycle=ephemeral id=heart-label
root = LearningSurface([reply])
reply = Anatomy3D("Label the heart", {"model": "heart", "mode": "label", "targets": ["rightAtrium", "rightVentricle", "leftAtrium", "leftVentricle", "tricuspidValve", "pulmonaryValve", "mitralValve", "aorticValve"], "question": "Drag each name onto its chamber or valve. Turn the heart by dragging the space around it, and pull a chamber aside to see the valve behind it."})
```

```openui lifecycle=ephemeral id=thorax-t4
root = LearningSurface([reply])
reply = Anatomy3D("Section at T4", {"model": "thoracicCrossSection", "mode": "section", "level": "T4", "targets": ["aorta", "superiorVenaCava", "trachea", "esophagus"], "question": "Drag the plane down to T4, then name the four structures on the slice."})
```
