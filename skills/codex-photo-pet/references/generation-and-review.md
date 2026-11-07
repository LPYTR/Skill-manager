# Generation and visual acceptance

## Base and references

Select references defining the intended appearance. With several outfits infer a dominant choice and state it, or ask when that choice materially matters. Use full-body photos for proportions/clothes and closer views for face/hair. Preserve supplied identity without promising biometric equivalence or inventing names, ages or affiliations.

For photorealism specify natural anatomy, real head/body proportions, skin/hair/cloth texture, stable neutral light, chosen outfit, and complete head/shoes. Do not silently substitute chibi/anime/toy proportions. Facial detail necessarily shrinks at 192×208; retain a high-resolution base separately.

```text
Asset: one horizontal STATE strip, exactly N separated complete poses.
Identity/style: the approved base, outfit and photo/art references.
Action: ordered phases for this state, including first and final poses.
Geometry: same physical scale, shared ground, gaps and safe outer margins.
Background: contrasting flat key or real alpha; no shadows/effects/labels.
Reference roles: identity, face, outfit, spacing, motion.
```

Respect the image tool's actual reference limit. A tested implementation allowed five inputs despite a looser schema. Consolidate redundant sources into a montage instead of omitting defining references. Use layout/stick-pose guides when needed; final pet pixels must still be generated art and guide marks must not survive.

## States

|State|Require|Reject|
|---|---|---|
|idle|quiet breathing/blink/sway|identical copies, work/wave/walk|
|running-right/left|correct direction, alternating cadence|same planted leading leg throughout, reversed order|
|waving|attached limb changes angle and returns|wave marks, detached fingers/effects|
|jumping|anticipation, lift, descent, same landing ground|resizing instead of lift, floor effects|
|failed|readable slumped/disappointed response|floating X/tears/smoke/stars|
|waiting|expectant asking/approval gesture|ordinary idle or unrelated inspection|
|running|focused processing/hand work|literal running or new props|
|review|inspect via lean/gaze/chin/nod|new text/UI/tools or indistinct waiting|

Asymmetric hair, markings, lighting, jewelry and handed props constrain mirroring. Mirror individual frames in temporal order only when identity/meaning remain correct; never flip an entire strip and reverse time.

For a repeatedly failed gait, establish contact A, passing A, opposite contact B, passing B. Require visible arm-swing swap and a knee passing through. Four real phases repeated twice are valid when documented. Holding a reviewed phase across consecutive cells is also valid for calmer cadence; an all-identical motion row is not. Distinguish repeated cycles from pose holds and do not call either eight unique phases. Use shared physical scale across source renders rather than filling each normalized cell independently.

## Extraction

A source shoe already clipped at the canvas edge cannot be restored by extraction. Diagnose source versus extraction failure first.

- Require complete separated groups. Unresolved merges/extra dominant groups block extraction.
- Preserve scale, source order and intentional vertical displacement. Register a planted reference at a common ground line. Inspect torso/limb anchors as well as bounds.
- Do not slice uneven source spacing into equal slots. Recover complete groups, then reflow if needed.
- Choose chroma absent from the character; preserve white clothes, eyes, socks and hair. Edge-local despill is not permission to flood-fill the outfit.
- Keep originals and actual extraction/repetition/registration records. Inspect antialias noise, alpha holes and attachments on a contrasting background.

## Gaze (v2 only)

Approve up/right/down/left anchors before coherent eight-pose rows. Torso/base stay planted; physical head/neck/eyes lead gaze. Downward pitch must retain enough facial landmarks; a scalp-only pose is a failure.

Generate/register row 9 before row 10. Ground the second half in completed first-half poses and approved anchors. Preserve exact clockwise order, scale and attachment. Fix ambiguous cardinals first. Repair a failing final look row coherently, not by pasting one unrelated normalized cell.

Review every labeled pose at native size and both row boundaries/wrap. Independent blind axis review can help when delegation is authorized; hide expected answers. Subtle near-cardinal intermediates may be documented warnings if the ordered arc stays correct. Wrong cardinal/quadrant, broad raster warps, whole-body turntable, disappeared face, clipping or reversal block release.

## Appearance edits

Preserve stable local identity and original image/config. Reference the actual source artwork and apply color changes consistently across all states/directions. Never stretch a newly generated full sheet to the old geometry and install known misalignment. Rebuild from approved row/frame sources when a whole-sheet edit changes pose positions.
