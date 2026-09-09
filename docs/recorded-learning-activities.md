# Recorded learning activities

`AudioResponse` and `VideoResponse` are OpenUI blocks for performance followed by reflection. The web app records on an explicit learner gesture, offers replay and another take, and saves the selected recording through the existing local attachment flow. Submit the activity to hand back its attachment metadata and reflection. Course delivery uses the existing outbox.

Try the stories under **Learning / Task**: **Mandarin Animal Recall**, **ASL Sign Recall**, and **Demonstrate And Explain**. These use real browser recording controls and local storage.

```openui lifecycle=resumable id=mandarin-animals
root = LearningSurface([attempt], "Ten animals in Mandarin", "Recall, replay, and choose one improvement.", "resumable")
attempt = AudioResponse("animals", "Animal recall", "Name ten distinct animals in Mandarin. Replay your attempt and use one uncertain word in a sentence on your next take.", ["Distinct animal names", "Identify uncertainty and plan a correction"], 30, "resumable")
```

```openui lifecycle=resumable id=asl-signs
root = LearningSurface([attempt], "Ten familiar ASL signs", "Clarity first, then fluency.", "resumable")
attempt = VideoResponse("signs", "Sign recall", "Sign ten ASL signs you have already practised. Keep your face and hands in view. Compare your replay with your course reference and choose one sign to revisit.", ["Visible handshape, movement and facial expression", "Identify one improvement"], 20, "resumable")
```

```openui lifecycle=resumable id=lever-demonstration
root = LearningSurface([attempt], "Show how a lever works", "Predict, demonstrate, explain.", "resumable")
attempt = VideoResponse({"id":"lever","title":"Move the pivot","brief":"Use a ruler and an eraser as a lever. Predict what changes when you move the pivot, then show the result. Include the microphone if you want to explain aloud.","criteria":["State your prediction","Show what happened","Name a real-world application"],"lifecycle":"resumable"})
```

Other prompts can use the same controls: explain a graph aloud; respond to a customer in another language; demonstrate a rhythm; narrate a worked example; show two solutions and justify which fits a real situation. Provide reference material separately using existing supported components.

Timing is optional, 1–180 seconds. Learners can turn off the target; untimed recordings stop after three minutes. Video microphone capture is opt-in. Files are capped at 25 MB, with the existing ten-attachment limit. Browser permissions and a secure context are required; file attachment is the fallback. Mobile native and terminal views point learners to the web recording controls.

This implements recording and submission, not automated transcription, word counting, pronunciation scoring, or sign recognition. A model receiving attachment metadata has not heard or seen the recording. Do not award correctness based on elapsed time. Replay exists in memory until **Use this attempt** saves it locally; an unselected take does not survive a page reload.
