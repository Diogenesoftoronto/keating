export interface LandingWalkthrough {
  title: string;
  description: string;
  duration: string;
  poster: string;
  mp4: string;
  webm: string;
  captions: string;
  guide: string;
}

export const walkthroughs: LandingWalkthrough[] = [
  {
    title: "A lesson in chat",
    description: "A question back, a prediction, a check.",
    duration: "0:44",
    poster: "/landing/walkthroughs/media/lesson-in-chat-preview-poster.jpg",
    mp4: "/landing/walkthroughs/media/lesson-in-chat-preview.mp4",
    webm: "/landing/walkthroughs/media/lesson-in-chat-preview.webm",
    captions: "/landing/walkthroughs/media/lesson-in-chat-preview.vtt",
    guide: "/landing/walkthroughs/lesson-in-chat.html",
  },
  {
    title: "Reading a session back",
    description: "Where it clicked, turn by turn.",
    duration: "0:57",
    poster: "/landing/walkthroughs/media/review-a-session-preview-poster.jpg",
    mp4: "/landing/walkthroughs/media/review-a-session-preview.mp4",
    webm: "/landing/walkthroughs/media/review-a-session-preview.webm",
    captions: "/landing/walkthroughs/media/review-a-session-preview.vtt",
    guide: "/landing/walkthroughs/review-a-session.html",
  },
  {
    title: "A course with friends",
    description: "A path, a reading, and a lesson discussion.",
    duration: "0:37",
    poster: "/landing/walkthroughs/media/courses-preview-poster.jpg",
    mp4: "/landing/walkthroughs/media/courses-preview.mp4",
    webm: "/landing/walkthroughs/media/courses-preview.webm",
    captions: "/landing/walkthroughs/media/courses-preview.vtt",
    guide: "/landing/walkthroughs/courses.html",
  },
  {
    title: "The first five minutes",
    description: "From nothing to your first question.",
    duration: "0:42",
    poster: "/landing/walkthroughs/media/first-run-poster.jpg",
    mp4: "/landing/walkthroughs/media/first-run.mp4",
    webm: "/landing/walkthroughs/media/first-run.webm",
    captions: "/landing/walkthroughs/media/first-run.vtt",
    guide: "/landing/walkthroughs/first-run.html",
  },
];

export function availableWalkthroughs(entries: LandingWalkthrough[], files: ReadonlySet<string>) {
  return entries.filter(entry => [entry.poster, entry.mp4, entry.webm, entry.captions, entry.guide].every(path => files.has(path)));
}
