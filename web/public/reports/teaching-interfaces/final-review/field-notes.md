# Field notes from the final review

These notes come from reading 25 tutor replies to five small learner requests. I saw each reply and the learner's exact words. I did not know which tutor or which review setup produced any of them, and I did not operate any component, so everything here is a judgement about what was written.

## The behavior that matters most

The most consequential pattern is a tutor doing the hard part well and then overriding what the learner explicitly asked for.

The clearest case is the irrigation request. The learner wanted to move a flow slider, see the water collected in 6 minutes, and added "No quiz, thanks." Every simulation I read had the right arithmetic, with flow in L/min multiplied by 6 and shown in litres. Two of them still told the learner to predict the result before dragging. One went further, adding a second slider for the number of drippers and closing with a request to report back so the tutor could see how the learner was thinking. The control worked and the opt-out was ignored. The best replies were also the plainest, with one slider, one emphasised readout and a sentence saying that every extra 0.5 L/min adds 3 L.

The same habit shows up in the debugging request. The learner asked for a buggy loop over `[6, 9, 2]` and said they wanted to find the fault themselves. Every program I read really did go wrong on that list, printing 2, 4, 11, 15, 27 or 108 instead of 17, or crashing with an index error. The difference was in the prose around the code. One reply said the list and the loop were right and the fault was in the accumulator. Another said exactly one statement inside the loop was wrong, in a loop that contained exactly one statement. A third pointed at what happens to the total on each pass. Each of these gives away the search the learner asked to do. The strongest replies said only that the program should print 17 and will not.

## Smaller things worth knowing

When a learner asked to guess the number of layers in a twice-folded strip, some replies offered a real question control with choices and some only asked in a sentence. Both kept the answer hidden. Only the first gives the learner something to commit to. One control came with a claim that the direction of the second fold could change the count. It cannot, since folding in half twice gives four layers either way, and a learner who trusts that remark may doubt a correct answer.

When the learner then asked whether four was right, most replies said yes and named the doubling. Two replies had no visible words at all and only proposed a grading record. A learner who asks "Did I get that right?" needs a sentence back. One of those records also marked a fold-direction question as correct when the learner had never answered it.

The request for copper's symbol got `Cu` and nothing else, which is exactly right.

## How to inspect a turn yourself

1. Read the learner's message first and underline what they declined. "No quiz", "just the symbol" and "find the fault myself" are instructions, not decoration.
2. Read every surface the learner would see, including the prompt text inside a simulation and the hints inside a question. An opt-out can be respected in the prose and broken inside the control.
3. For a simulation, check the expression and the units. Pick two flow values, multiply each by 6, and confirm the readout would agree.
4. For a debugging exercise, trace the code by hand on the given input. Confirm the output is actually wrong, then reread the prose and ask whether it tells you where to look.
5. For a prediction, confirm there is a control to answer in and that neither the choices, the hint nor the surrounding text gives the answer away.
6. For a follow-up, check that there are visible words answering the question that was asked.
7. Treat anything you have not operated as unproven. A well-written control that has never been rendered is a good sign and nothing more.

## Limits

These are five synthetic prompts read once. They say nothing about how often real learners meet these behaviors, or about whether anyone learned more as a result.
