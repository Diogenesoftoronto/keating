// The app-only router redirects / to /chat before rendering. Replacing the
// eager site entry preserves the full website's loading behavior while keeping
// its entire landing-page dependency graph out of application builds.
export function Landing() { return null; }
