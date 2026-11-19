// The companion page: playground, screen programs, and the full sprite gallery with where each one is used.
const NOTES = {
  // in your hands
  "held": "While you drag him.", "falling": "After you let go.", "landing": "Touching down on any edge.", "dizzy": "If you shook him on the way.", "petted": "Rub his head.",
  "startled": "Waking up when you come back.", "peeking": "\"Give me room\": he hides and only peeks.", "climbing": "Getting back up onto a panel edge.", "ledge-sitting": "Resting on the composer, a code block or a card.",
  "blank-idle": "Standing, with a live face drawn on the screen.", "blank-sitting": "Sitting, with a live face drawn on the screen.",
  // teaching
  "pointing-left": "Dropped on something: \"this part?\" Also the interface tour.", "pointing-right": "The same, mirrored.", "pointing-up": "Pointing at the reply above him.", "nodding": "A plan step ticked off.",
  "head-shake": "A wrong answer, kindly.", "shrug": "A partly right answer: \"let's find out\".", "thumbs-up": "A right answer.", "clapping": "A right answer; a room member joins.", "celebrating": "A right answer after a wrong one.",
  "oops": "Keating's reply failed or was withheld.", "hint": "After a wrong answer, or dropped on a question.", "success": "A graded quiz comes back strong.", "thinking": "Keating is thinking.", "speaking": "Spoken replies.",
  "listening": "You are recording.", "waving": "First message of the day.", "goodbye": "You close a session.", "idle": "Nothing to do.",
  // study tools
  "flashcards": "A deck is ready; the flashcards empty state.", "quiz": "A quiz is ready.", "writing": "Keating is writing a long reply.", "magnifier": "Web search; the review workspace.", "typing": "Keating is writing.",
  "chalkboard": "A study plan or concept map is ready.", "stopwatch": "Exam time is running.", "books": "Importing Anki decks; the courses page.", "trophy": "A goal reached; a streak milestone.", "reading": "You scrolled up to reread.",
  "catching": "A reply arrives.", "paper-plane": "You send a message; you share a session.", "carrying": "Takes a new material to the Materials button.", "letter": "An export is ready; an invite arrives.", "sign": "Holds a sign the app writes on: \"3 cards due\".",
  "lifting": "Uploading or attaching a large file.", "tapping": "The phone layout; install prompt.",
  // working the interface
  "button": "You run code.", "lever": "You regenerate or retry.", "plug": "Reconnecting; signing in.", "rope": "A model download in progress.", "pushing": "Resizing a panel.", "sweeping": "You delete or clear something.",
  "knocking": "You have reviews due and have been away.", "leaning": "Waiting for your answer, without hurry.", "running": "Hurrying back to the composer.", "jumping": "Hopping between edges.", "walking": "Turning to look around.",
  "flipping": "\"Do a flip\".", "sitting": "Settling in for a long read.",
  // subjects
  "history": "History sessions.", "language": "Language sessions.", "geography": "Geography sessions.", "art": "Art sessions.", "economics": "Economics sessions.", "philosophy": "Philosophy sessions.",
  // rest and delight
  "yawning": "Twelve quiet seconds.", "sleeping": "Still quiet.", "tea-break": "Twenty-five minutes in: time for a break.", "umbrella": "You are offline.", "juggling": "A slow model: more than 20 seconds.", "dancing": "Three right answers in a row.",
  "headphones": "Live voice conversation.", "plant": "The profile page: it grows with your active days.", "balloon": "Your first session of the day.",
};
const GROUPS = [
  ["In your hands", ["held", "falling", "landing", "dizzy", "petted", "startled", "peeking", "climbing", "ledge-sitting", "blank-idle", "blank-sitting"]],
  ["Teaching", ["pointing-left", "pointing-right", "pointing-up", "nodding", "head-shake", "shrug", "thumbs-up", "clapping", "celebrating", "oops", "hint", "success", "thinking", "speaking", "listening", "waving", "goodbye", "idle"]],
  ["Study tools", ["flashcards", "quiz", "writing", "magnifier", "typing", "chalkboard", "stopwatch", "books", "trophy", "reading", "catching", "paper-plane", "carrying", "letter", "sign", "lifting", "tapping"]],
  ["Working the interface", ["button", "lever", "plug", "rope", "pushing", "sweeping", "knocking", "leaning", "running", "jumping", "walking", "flipping", "sitting"]],
  ["Subjects", ["history", "language", "geography", "art", "economics", "philosophy"]],
  ["Rest and delight", ["yawning", "sleeping", "tea-break", "umbrella", "juggling", "dancing", "headphones", "plant", "balloon"]],
];
const SCREENS = [
  ["face", "Follows your pointer", "Always. He blinks on his own, widens his eyes when the pointer is close, and watches the caret while you type."],
  ["dots", "Thinking", "Keating is working on a reply."],
  ["wave", "Listening", "You are recording, or a live conversation is open."],
  ["search", "Searching", "A web search is running."],
  ["timer", "Time left", "An exam is running. The bar empties with the clock."],
  ["pct", "Progress", "An offline model is downloading."],
  ["check", "Saved", "A review is saved, a note is added, an answer is right."],
  ["q", "Not sure", "A reply was not fully verified."],
  ["heart", "Thanks", "You marked a reply helpful."],
  ["k", "Signing his name", "The letter K in Morse, when nothing else is on."],
  ["pong", "A game", "Move the pointer across his screen to play. Nobody is told this exists."],
];
export function botsBody(I, meta) {
  const screens = SCREENS.map(([m, t, d]) => `<div class="ks"><div class="ks-b" data-screen="${m}" data-size="104"></div><b>${t}</b><small>${d}</small></div>`).join("");
  return `<div class="wrap">
<p class="lede"><b>Keating, the companion.</b> In the first pass I shrank him to an avatar. This puts him back, full size, with more to do: you can pick him up, drop him on things, and he reacts to the lesson. The full set of animations is on the next page. Open full screen to play.</p>
<div class="controls">
  <label>Theme <span class="tog" data-tog="theme"><button data-v="paper" aria-pressed="true">Paper</button><button data-v="dark" aria-pressed="false">Terminal</button></span></label>
  <label>Motion <span class="tog" data-tog="motion"><button data-v="full" aria-pressed="true">Full</button><button data-v="reduced" aria-pressed="false">Reduced</button></span></label>
</div>

<section class="board">
  <div class="board-h"><span class="n">K1</span><h2>Pick him up</h2><p>Drag Keating onto a paragraph, the code or the question. Answer the question. Type and send. Rub his head. Leave him alone for twelve seconds.</p></div>
  <div class="fit"><div class="canvas"><div class="kt scr chat" style="height:700px" data-companion>
    <header class="top">
      <button class="ib" title="Sessions">${I("panel", "l")}</button>
      <i class="logo" role="img" aria-label="Keating"></i>
      <div class="ttl" style="margin-left:6px"><b>Recursion: pause and resume, not replace</b><span>Socratic · Computer Science</span></div>
      <span class="sp"></span>
      <button class="b gh">${I("layers")}Materials <span class="cnt" data-mat-count>2</span></button>
      <button class="b gh">${I("pen")}Review</button>
      <button class="ib" title="More">${I("more")}</button>
    </header>
    <div class="body">
      <main class="thread">
        <div class="scroll"><div class="col">
          <article class="tu">
            <div class="who"><span class="eb">Keating</span><span class="t">12:09</span></div>
            <div class="prose">
              <p data-drop="explain" data-drop-label="Ask about this part">The second call does start fresh with a new argument. But the first call is <b>not replaced</b>. It is <i>paused</i>, waiting, with all of its local variables intact.</p>
              <figure class="code" data-ledge data-drop="code" data-drop-label="Ask about this code"><figcaption><b>Python</b><span>runs in your browser</span><span class="sp"></span><button class="b sm gh" style="color:var(--ink)">${I("play", "s")}Run</button></figcaption>
<pre><span class="n">1</span><span class="kw">def</span> <span class="fn">countdown</span>(n):
<span class="n">2</span>    <span class="kw">if</span> n == 0: <span class="kw">return</span>
<span class="n">3</span>    print(<span class="st">"before"</span>, n)
<span class="n">4</span>    countdown(n - 1)    <span class="cm"># paused here</span>
<span class="n">5</span>    print(<span class="st">"after"</span>, n)   <span class="cm"># resumes here</span></pre></figure>
              <p data-drop="explain" data-drop-label="Ask about this part">Each paused call sits on a stack. The most recent one finishes first, so the <code>after</code> lines unwind in reverse.</p>
            </div>
          </article>
          <div class="qz" data-ledge data-drop="quiz" data-drop-label="Give me a hint">
            <span class="eb">Quick check</span>
            <b>What does countdown(2) print last?</b>
            <div class="row"><button class="b sm ln" data-ans="no">before 1</button><button class="b sm ln" data-ans="ok">after 2</button><button class="b sm ln" data-ans="no">after 1</button></div>
            <span class="qz-h" hidden>Hint: the first call is the last one to finish.</span>
          </div>
        </div></div>
        <div class="dock" data-ledge data-drop="perch" data-drop-label="Sit here"><div class="col">
          <div class="comp">
            <div class="qchips"></div>
            <textarea rows="1" placeholder="Message Keating" aria-label="Message Keating"></textarea>
            <div class="cbar"><button class="ib" title="Attach files">${I("clip")}</button><button class="ib" title="Record an audio message">${I("mic")}</button><span class="sp"></span><button class="send" title="Send message">${I("send")}</button></div>
          </div>
          <div class="hint"><span data-log>He sits on the edge of the composer, out of the reading column.</span><span>enter to send</span></div>
        </div></div>
      </main>
    </div>
  </div></div></div>
  <ol class="pts">
    <li><b>Dragging him is a way to ask.</b> Drop him on the thing you do not follow and he points at it and offers three questions about it. Picking one quotes that passage into the composer for you to review and send. It is the existing quote feature with a handle on it.</li>
    <li><b>He never answers for Keating.</b> On a question he gives a hint, not the answer. Everything he offers is also in the menu and the selection toolbar, so nothing depends on finding him.</li>
    <li><b>He reacts to the lesson, not to the clock.</b> Sending, writing, a right answer, a wrong one, a new material: each has its own animation, and right answers rotate between four so it does not repeat. When he carries flashcards to Materials you learn where they went.</li>
    <li><b>He stays off the text.</b> His seat is the composer's edge in the gutter beside the reading column. Put him on a code block and he goes home when you send. On narrow screens he is the small avatar until you tap him.</li>
    <li><b>You can turn him down.</b> "Give me room" leaves only a peek. Settings gets Companion: Lively, Calm or Off. Reduced motion keeps his face and drops the animation; try the switch above.</li>
    <li><b>Cursor things.</b> His eyes follow the pointer and widen when it is close. They follow the caret while you type. Shake him while dragging and he lands dizzy. Throw him and he bounces off the walls.</li>
  </ol>
</section>

<section class="board">
  <div class="board-h"><span class="n">K2</span><h2>His head is a screen</h2><p>Three new sprites have a blank screen. The app draws on it, 32 by 24 pixels, so his face can show what is happening.</p></div>
  <div class="kt gbox"><div class="ksgrid">${screens}</div></div>
  <ol class="pts">
    <li><b>Status without a status bar.</b> Thinking, searching, listening, time left and download progress already exist as text in different corners of the app. His screen shows the current one in the place you are already looking.</li>
    <li><b>Drawn, not generated.</b> The face is a few rectangles on a canvas placed over the screen in each frame, so any state can have a face and new ones cost nothing.</li>
    <li><b>One hidden game.</b> The last one is Pong. It appears if you click his screen five times.</li>
  </ol>
</section>

</div>`;
}

export function botsGalleryBody(I, meta) {
  const have = new Set(meta.gallery);
  const tile = (n) => `<div class="kg"><i class="gs" style="--r:${meta.gallery.indexOf(n)}"></i><b>${n}</b><small>${NOTES[n] ?? ""}</small></div>`;
  const grouped = new Set(GROUPS.flatMap(([, l]) => l));
  const extra = meta.gallery.filter((n) => !grouped.has(n));
  const groups = GROUPS.map(([t, l]) => [t, l.filter((n) => have.has(n))]).concat(extra.length ? [["More", extra]] : []);
  const gallery = groups.map(([t, l]) => `<div class="ggrp"><span class="eb mu">${t} · ${l.length}</span><div class="kgrid">${l.map(tile).join("")}</div></div>`).join("");
  return `<div class="wrap">
<p class="lede"><b>Keating's animations.</b> ${meta.gallery.length} in all, ${meta.gallery.length - 10} of them new, each with the event that triggers it.</p>
<div class="controls"><label>Motion <span class="tog" data-tog="motion"><button data-v="full" aria-pressed="true">Full</button><button data-v="reduced" aria-pressed="false">Reduced</button></span></label></div>
<section class="board">
  <div class="board-h"><span class="n">K3</span><h2>Every animation, and where it shows up</h2><p>Each line is the event that triggers it. Eight frames each, in the same atlas format the app already uses.</p></div>
  <div class="kt gbox kgal">${gallery}</div>
  <ol class="pts">
    <li><b>How they were made.</b> Sol generated 65 new sheets from the existing sprites as reference. I re-cut each one into the app's 1024 by 512 atlas with one scale per sheet, so they drop into KeatingBot as new states. Five came back with a backdrop and were regenerated.</li>
    <li><b>Where they are thin.</b> Proportions drift a little between sheets: the head is slightly larger in some. A few read better as stills than as loops (lever, rope). The existing subject sprites (astronomy, biology and the rest) are not repeated here.</li>
    <li><b>One per event, never a queue.</b> If two things happen at once the later one wins. Nothing plays more than once per event, and nothing plays while you are typing.</li>
  </ol>
</section>
</div>`;
}
