// Kept as a compatibility endpoint for already-installed service workers.
// Activation must not navigate open tabs: it can interrupt startup, sign-in,
// or a message being composed. New workers no longer import this script.
