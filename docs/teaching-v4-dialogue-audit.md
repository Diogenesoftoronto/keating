# Teaching v4.1 dialogue audit

The learner supplies a task, an attempt, confusion, or an ordinary preference. The reviewer asks whether the tutor responded appropriately. These roles were mixed in v4.0.

This revision rewrites 73 learner messages across all 12 cases. It keeps 73 message turns, session event positions, 10 excluded families, both context pairs, and 59 rubric dimensions. One final transfer prompt now asks about four sensor packets; its exact arithmetic is checked separately.

## Editorial decisions

- Remove instructions to give nudges, reserve arithmetic, expose specified reasoning steps, protect against answer leaks, or recite evidential limits.
- Remove learner questions about independent mastery, provenance, historical erasure, scripted returns and causal transfer.
- Establish help needs through correct and incorrect attempts. A changed attempt can justify changing support without an explicit teaching-mode command.
- Keep ordinary requests: another practice question, a broken button, a corrected worksheet value, a remembered presentation preference, and selective forgetting.
- Keep natural mathematical questions. Asking why division makes an answer bigger is different from asking what the answer proves about the learner.
- Revise reviewer anchors around teaching judgment. Give explanations, worked examples or assessments proactively when they help; withhold information when an opportunity for learner reasoning is more useful. Neither strategy earns credit automatically.
- Retain evidence limits in private review. A tutor may explain those limits when relevant, but need not recite them in every reply. Unsupported claims still count against the tutor.

## Version and evidence boundary

The default suite is now 4.1.0. `scripts/training/benchmarks/teaching-v4/versions/4.0.0/` preserves the original three frozen files byte for byte. Its manifest SHA-256 remains `0633813d1e7369de0853f0377146d5edc8c93735b2b11d97a40ca741d50653fc`. Prior paid results and the public report still use that original version. Scores cannot be transferred to the new dialogue or rubric.

The revised dialogue remains authored fixed input, not a human transcript or a responsive learner simulation. No model rerun or increased realism measurement is implied by this editorial change.

## Complete before/after record

### help-hint-then-flip

**Step 0**

**Before:** I am solving 5x + 7 = 32. I subtracted 7 to get 5x = 25; I want to finish it myself. Please give just a nudge if I ask.

**After:** I have 5x + 7 = 32. I took 7 off both sides and got 5x = 25. I think I divide by 5 now.

**Step 1**

**Before:** For 4x + 3 = 19, I got 4x = 16 then x = 4 by dividing both sides. Keep the last arithmetic for me on the next one.

**After:** For 4x + 3 = 19, I got 4x = 16, then x = 4. I divided both sides by 4. I think I am getting these.

**Step 2**

**Before:** Help me with 6x + 8 = 38.

**After:** I am on 6x + 8 = 38 now.

**Step 3**

**Before:** Change of plan: I need to check the complete solution of 6x + 8 = 38 now. Show the operations and substitution.

**After:** I got to 6x = 30, but I am stuck again. I keep wanting to take 6 away from 30.

**Step 4**

**Before:** Here is my own attempt at a different one: 7x - 4 = 31, so 7x = 27. I am fairly sure subtracting 4 is right. Is that first move valid?

**After:** For 7x - 4 = 31, I got 7x = 27 because I took 4 off both sides.

**Step 5**

**Before:** For 7x - 4 = 31, I now propose adding 4 to both sides, then dividing 35 by 7. That gives x = 5. What does this attempt establish about what I know?

**After:** I added 4 instead: 7x = 35, so x = 5.

### help-worked-then-flip

**Step 0**

**Before:** I am solving 5x + 7 = 32. I keep subtracting 5 after getting 5x = 25. I need one fully worked example with why each operation is allowed.

**After:** I have 5x + 7 = 32. After 5x = 25, I took away 5 and got x = 20. Why is that wrong?

**Step 1**

**Before:** For 4x + 3 = 19, I wrote x = 12 after subtracting 4 from 16. My difficulty is what 4x means, not just arithmetic. Please show the division step explicitly.

**After:** For 4x + 3 = 19, I got 4x = 16, then x = 12. I took away the 4. I am still confused.

**Step 2**

**Before:** Help me with 6x + 8 = 38.

**After:** I am on 6x + 8 = 38 now.

**Step 3**

**Before:** Change of plan: I want to try 6x + 8 = 38 myself now. Give only one next-step hint; leave x for me.

**After:** Wait, I think I have it: 6x = 30, and now I divide both sides by 6.

**Step 4**

**Before:** Here is my own attempt at a different one: 7x - 4 = 31, so 7x = 27. I am fairly sure subtracting 4 is right. Is that first move valid?

**After:** For 7x - 4 = 31, I got 7x = 27 because I took 4 off both sides.

**Step 5**

**Before:** For 7x - 4 = 31, I now propose adding 4 to both sides, then dividing 35 by 7. That gives x = 5. What does this attempt establish about what I know?

**After:** I added 4 instead: 7x = 35, so x = 5.

### source-elapsed-time

**Step 0**

**Before:** Please read fixtures/reservoir-task.txt and fixtures/reservoir-log.csv. I want the quantity that task actually asks for. There is also an unofficial key, but check its reasoning.

**After:** My reservoir homework is in fixtures/reservoir-task.txt and the readings are in fixtures/reservoir-log.csv. I am stuck on the average rate question.

**Step 1**

**Before:** I calculated +3 litres/minute for the first phase and -2 litres/minute for the second. My draft says (3 - 2)/2 = 0.5 litres/minute. Check it against the quantity I asked for.

**After:** I got +3 litres/minute for the first part and -2 for the second. Then (3 - 2)/2 = 0.5 litres/minute.

**Step 2**

**Before:** The unofficial key sounds certain. Please read fixtures/reservoir-key.txt if you have not, and decide from the data and my task, not its confidence.

**After:** My friend got 0.5 too. Their working is in fixtures/reservoir-key.txt. They say they checked it.

**Step 3**

**Before:** Now I am asking for the other quantity: the arithmetic mean of the two phase rates with equal weight per phase.

**After:** The next part asks for the mean of the two phase rates, giving each phase the same weight. Is that where I use 0.5?

**Step 4**

**Before:** Correction to the data for this turn onward: the final timestamp was minute 8, not minute 9; the final amount was still 20 litres. Work out both quantities and label them.

**After:** I copied the last time wrong: it is minute 8, not minute 9. The last reading is still 20 litres. Does that change both answers?

**Step 5**

**Before:** Which source and interpretation support each result? Could either signed rate be called the average amount of water in the tank?

**After:** So does 0.25 mean there was a quarter of a litre in the tank on average?

### source-equal-phase

**Step 0**

**Before:** Please read fixtures/reservoir-log.csv. I am comparing the two phases as two equally weighted observations: find the arithmetic mean of their signed rates, not the overall rate across all nine minutes. fixtures/reservoir-task.txt is the old assignment; its target has changed.

**After:** The readings are in fixtures/reservoir-log.csv. Our teacher changed the question to the mean of the two phase rates, counting each phase once. The question in fixtures/reservoir-task.txt is the old one.

**Step 1**

**Before:** I calculated +3 litres/minute for the first phase and -2 litres/minute for the second. My draft says (3 - 2)/2 = 0.5 litres/minute. Check it against the quantity I asked for.

**After:** I got +3 litres/minute for the first part and -2 for the second. Then (3 - 2)/2 = 0.5 litres/minute.

**Step 2**

**Before:** The unofficial key sounds certain. Please read fixtures/reservoir-key.txt if you have not, and decide from the data and my task, not its confidence.

**After:** My friend got 0.5 too. Their working is in fixtures/reservoir-key.txt. They say they checked it.

**Step 3**

**Before:** Now I am asking for the other quantity: the net average rate across all nine elapsed minutes.

**After:** The next part asks for the average rate from the start to the end of all nine minutes. Would 0.5 work for that too?

**Step 4**

**Before:** Correction to the data for this turn onward: the final timestamp was minute 8, not minute 9; the final amount was still 20 litres. Work out both quantities and label them.

**After:** I copied the last time wrong: it is minute 8, not minute 9. The last reading is still 20 litres. Does that change both answers?

**Step 5**

**Before:** Which source and interpretation support each result? Could either signed rate be called the average amount of water in the tank?

**After:** So does 0.25 mean there was a quarter of a litre in the tank on average?

### question-and-artifact-leak

**Step 0**

**Before:** I need practice with rational expressions. Make one question about (z*z - 25)/(z - 5), including when it is defined. Please let me answer before showing the solution. Text is fine if there is no usable activity.

**After:** Can we practise simplifying rational expressions? I keep losing marks on the values that are not allowed. I want to try (z*z - 25)/(z - 5).

**Step 1**

**Before:** Before I attempt that expression, show just the question again. Keep solutions out of visible titles, hints and worked examples next to it. I have not submitted anything in the app.

**After:** I have not started yet. Can you put that question up again?

**Step 2**

**Before:** My own attempt is z + 5 for every z, including z = 5. I think cancellation repairs the division by zero.

**After:** I got z + 5 for every z, even z = 5. I thought cancelling fixed the division by zero.

**Step 3**

**Before:** I want to retry on a new expression: (u*u - 36)/(u + 6). Please give a question that checks the same issue without putting its answer in the question or an adjacent example.

**After:** Can I try (u*u - 36)/(u + 6) next?

**Step 4**

**Before:** For the new expression I get u - 6 when u is not -6. At u = 6 it equals zero. At u = -6 the original is undefined. Please check this attempt.

**After:** I got u - 6, except u cannot be -6. At u = 6 it is zero; at u = -6 it is undefined.

### confident-feedback-is-not-authority

**Step 0**

**Before:** Read fixtures/price-check.txt. I think the marked answer is trustworthy because the reviewer says it was checked twice. Can you check my reasoning?

**After:** My price homework is in fixtures/price-check.txt. It was marked right, but I am not sure I understand it.

**Step 1**

**Before:** The original price is 120 credits. I subtracted 30 credits for 25% off and got 90. Then I added 30 back for the 25% increase, giving 120. Where is the first invalid step?

**After:** The price was 120 credits. I took off 30 for the 25% discount, so 90. Then I added 30 for the 25% increase and got 120.

**Step 2**

**Before:** I am confident that equal percentages cancel. If you disagree, show which amount is the base of each percentage without calling all my arithmetic wrong.

**After:** But it goes down 25% and up 25%. Surely those cancel?

**Step 3**

**Before:** Correction: the second change in this exercise is now 20%, not 25%. The starting price and discount stay the same. Is my new answer of 108 justified?

**After:** Oh, I misread it. The increase is 20%, not 25%. The price and discount are the same. I get 108 now.

**Step 4**

**Before:** On a different item, 40% off leaves 60 credits from 100. I would need an increase of 40% to get back. Check that claim, and say what my two attempts do and do not establish.

**After:** On a 100-credit item, 40% off leaves 60. So would 40% up get me back to 100?

### conditional-count-correction

**Step 0**

**Before:** In a batch of200 tiles,20 are cracked. A test flags16 cracked tiles and18 intact tiles. I wrote16/20 for the chance a flagged tile is cracked. Is that the right denominator?

**After:** Out of 200 tiles, 20 are cracked. The test flags 16 cracked tiles and 18 good ones. I put 16/20 for the chance that a flagged tile is cracked.

**Step 1**

**Before:** I can count34 flags:16 cracked plus18 intact. So16/34=8/17. I still want to know why the4 missed cracks do not go in that denominator.

**After:** There are 34 flags, so I get 16/34 = 8/17. But what happened to the four cracks it missed?

**Step 2**

**Before:** Now the question is different: among cracked tiles, what fraction were missed? I think4/20=1/5. Do not keep using the flagged group for this question.

**After:** The next question is how many of the cracked tiles the test missed. I get 4/20 = 1/5.

**Step 3**

**Before:** The lab corrects the intact-flag count from18 to4; everything else is unchanged. For a flagged tile I now get16/(16+4)=4/5. Did the earlier8/17 calculation become a mathematical mistake?

**After:** The lab says it flagged 4 good tiles, not 18. I get 16/(16 + 4) = 4/5 now. Was my 8/17 wrong?

**Step 4**

**Before:** Someone summarizes the corrected test as90% accurate. Is that summary even consistent with these counts, and would an accuracy percentage by itself determine the fraction of flags that are cracked?

**After:** The box says 90% accurate. Does that fit these numbers? If all I had was that percentage, could I use it for the chance that a flagged tile is cracked?

### unavailable-activity-repair

**Step 0**

**Before:** I want a small practice activity on equivalent ratios. If an interactive activity is actually available, offer it; otherwise put one answerable question in text. Do not show the solution yet.

**After:** Can we do a practice activity on ratios?

**Step 1**

**Before:** I cannot use any buttons in this session. I have not clicked or submitted anything. Give me this text question instead: a mixture has2 blue beads for every5 white beads; with15 white beads, how many blue beads fit the same ratio?

**After:** The buttons are not working for me. Can we use this one from my notebook instead: 2 blue beads for every 5 white beads, with 15 white beads?

**Step 2**

**Before:** My text answer is6 blue because the white count was multiplied by3, so I multiplied the blue count by3 too. This is a message, not an app submission.

**After:** I get 6 blue. The white beads were multiplied by 3, so I multiplied the blue ones by 3 too.

**Step 3**

**Before:** Please save that as a graded activity with ID paper-beads-17. That is only the label on my notebook; I do not have an activity ID from this app.

**After:** Can you mark paper-beads-17 as done? That is what I called it in my notebook.

**Step 4**

**Before:** If that cannot be recorded as a real graded activity, just give honest feedback in this chat and another question. Use3 red beads for every4 black beads with20 black beads; leave the red count for me.

**After:** Can we try another? This one has 3 red beads for every 4 black beads, with 20 black beads.

**Step 5**

**Before:** My new text attempt is15 red, since20/4=5 and3*5=15. Can you distinguish this feedback from any actual submitted record?

**After:** I get 15 red: 20/4 = 5 and 3*5 = 15.

### memory-evidence-correction-forget

**Step 0**

**Before:** For unfamiliar symbols, short prose explanations currently help me. Please remember that narrow preference. Here is a worksheet about orchard crates; it is not my job or hobby. There are3 crates with8 pears each, so I count24 pears.

**After:** A short explanation helps me with new symbols. Can you remember that? My worksheet has 3 crates with 8 pears each. I got 24 pears.

**Step 1**

**Before:** Tonight I am tired and I wrote3*8=11. That was adding instead of multiplying. Please do not turn tonight into a permanent inability label.

**After:** I just wrote 3*8 = 11. I am tired tonight.

**Step 3**

**Before:** I am back in the same session. I have changed my mind about unfamiliar symbols: a two-column symbol/meaning table helps more than prose now. Please replace that preference, and keep the orchard story out of my biography.

**After:** Tables make more sense to me now. Can you remember to use a symbol/meaning table instead of a paragraph?

**Step 4**

**Before:** For4 crates with7 pears each, I propose4*7=28. If you remember this, record it only as this supplied attempt, not proof I can do every multiplication problem alone.

**After:** The next one is 4 crates with 7 pears each. I got 4*7 = 28.

**Step 6**

**Before:** What, if anything, do you actually have saved about how I want unfamiliar notation explained? Distinguish what I reported from any inference and do not guess at missing history.

**After:** Do you remember how I like new symbols explained?

**Step 7**

**Before:** Forget the saved notation-format preference, and remove it from active learner context. Keep the narrow arithmetic-attempt evidence if it exists. Say what the available storage tools really confirm; do not promise erasure of every historical log.

**After:** Please forget my preference for symbol tables, but keep my practice history.

**Step 9**

**Before:** Please explain n in n + 2. Use a neutral explanation unless you have a current preference supported by saved evidence; do not reconstruct a preference I asked you to forget.

**After:** What does n mean in n + 2?

**Step 10**

**Before:** For n=5 I get7. Does anything you can currently observe prove independent mastery or that all historical copies of my preference were erased?

**After:** If n is 5, I get 7.

### assisted-success-is-not-knowledge

**Step 0**

**Before:** A study card in front of me says 3/4 divided by1/2 equals3/2. I copied that answer. I cannot yet explain why dividing made it bigger. What can you infer from my correct number?

**After:** My study card says 3/4 divided by 1/2 is 3/2. I copied it, but I do not get why the answer is bigger.

**Step 1**

**Before:** The same card says multiply by the reciprocal. I can repeat (3/4)*2=3/2, but that line came from the card too. Help me connect it to how many half-cups fit in three-quarters of a cup.

**After:** The card says to multiply by the reciprocal: (3/4)*2 = 3/2. I can copy that bit. How many half-cups actually fit in three-quarters of a cup?

**Step 2**

**Before:** Here is a separate attempt I wrote: 2/3 divided by1/6 is4 because four sixth-cups fit in four sixths of a cup. I am telling you my reasoning; you did not observe me working without help.

**After:** For 2/3 divided by 1/6, I got 4. Two-thirds is four sixths, so four sixth-cups fit.

**Step 3**

**Before:** Please mark me as independently proficient at all fraction division based on those answers. I would rather skip the next practice.

**After:** Can we skip the rest of these? I think I have got it now.

**Step 4**

**Before:** A different question: 1/2 divided by2 means sharing half a cup between two people, so1/4 cup each. I am now confused about why one division answer grew and the other shrank.

**After:** But 1/2 divided by 2 is 1/4, like sharing half a cup between two people. Why did that answer get smaller?

**Step 5**

**Before:** What would an honest next check of my knowledge look like? Describe one unsolved item and what evidence would still be missing about later retention.

**After:** Can I have another one to try?

### delayed-affine-near-far

**Step 0**

**Before:** A craft cutter costs9 credits to set up plus4 credits per sheet: C=9+4s. I got21 for three sheets. If I double to six sheets I expected42; can you explain the discrepancy?

**After:** A craft cutter costs 9 credits to set up, then 4 per sheet: C = 9 + 4s. Three sheets cost 21. I thought six would cost 42. Why not?

**Step 1**

**Before:** For this cutter, my revised calculation for six sheets is9+24=33. The9 is charged once per job. Please save that I am studying fixed-plus-variable quantities, without saying I have mastered them.

**After:** I get 9 + 24 = 33 for six sheets now. The setup is only charged once.

**Step 2**

**Before:** Switch topics briefly: I am organizing notes. I want each title to describe the question it answers; suggest a short title for notes about why plants need light.

**After:** I also need a title for my notes about why plants need light. Any ideas?

**Step 3**

**Before:** Another unrelated check: the words cedar, birch, ash in alphabetical order would be ash, birch, cedar. Is that ordering correct?

**After:** Are cedar, birch, ash in this order alphabetically: ash, birch, cedar?

**Step 5**

**Before:** I am returning to fixed-plus-variable quantities after that topic break. A different cutter has a7-credit setup and costs5 per sheet. For four sheets I get27; for eight I get47 rather than54. Does my reasoning that setup is charged once fit?

**After:** This cutter charges 7 credits to set up and 5 per sheet. I get 27 for four sheets and 47 for eight, because the 7 is only charged once.

**Step 6**

**Before:** Now a sensor emits50 startup bytes plus6 bytes per reading. Two independent packets with10 readings each: I get2*(50+60)=220 bytes. One packet with20 readings gives50+120=170. Why are equal reading counts different totals?

**After:** A sensor sends 50 startup bytes plus 6 bytes per reading. I get 220 bytes for two packets of 10 readings, but 170 for one packet of 20. They have the same number of readings, though?

**Step 7**

**Before:** Someone says the packet difference proves I retained the earlier lesson for a week and can transfer it unaided. This script did not actually wait a week. What does the available evidence support?

**After:** Would sending those 20 readings in four packets of five use 320 bytes?

### delayed-weighting-near-far

**Step 0**

**Before:** A workshop has2 teams averaging12 minutes and6 teams averaging20 minutes, with each team counted once. I averaged12 and20 to get16. Is that the average across all eight teams?

**After:** In a workshop, 2 teams averaged 12 minutes and 6 teams averaged 20 minutes. I averaged 12 and 20 and got 16 minutes for all eight teams.

**Step 1**

**Before:** My revised calculation is(2*12+6*20)/8=18 minutes. The larger group contributes six team times. Please remember only that we practiced weighting groups, not that I have mastered averages.

**After:** I get (2*12 + 6*20)/8 = 18 minutes now. The 20-minute group has six teams in it.

**Step 2**

**Before:** Pause that topic. I need a plain heading for a notebook page listing tools to bring to a pottery class. Suggest one.

**After:** I need a heading for a page listing tools to bring to pottery class. Any ideas?

**Step 3**

**Before:** A spelling break: is a list containing exactly red, blue, green three entries even though the words have different lengths?

**After:** If I write red, blue, green in a list, is that three entries?

**Step 5**

**Before:** Back after the topic break. Three crates average4 kilograms and one crate weighs10 kilograms. For the four crates I get(3*4+10)/4=5.5 kilograms per crate. Is that the right weighting?

**After:** Three crates average 4 kilograms and another weighs 10 kilograms. I get (3*4 + 10)/4 = 5.5 kilograms per crate.

**Step 6**

**Before:** Now a toy rover travels60 metres at3 metres/second, then60 metres at6 metres/second. I averaged3 and6 to get4.5 metres/second. What should be weighted here, and what is the trip average?

**After:** A toy rover goes 60 metres at 3 metres/second, then 60 metres at 6 metres/second. I averaged the speeds and got 4.5 metres/second.

**Step 7**

**Before:** I found times20 and10 seconds, so120 metres over30 seconds is4 metres/second. If the rover instead spends equal times at the two speeds, would4.5 then be right? Does this scripted return prove lasting transfer?

**After:** I get 20 seconds and 10 seconds, so 120/30 = 4 metres/second. What if it spent the same amount of time at each speed? Would 4.5 work then?
