// Whether the "big update" popup or the walkthrough has been active during this app load.
// Used to keep secondary prompts (the review request especially) quiet so a user's first
// experience of an update isn't a pile-on. It's an in-memory flag, so it resets on the next
// cold start / reload — a deferred prompt returns naturally on a later session.
let active = false;
export function markIntroActive() { active = true; }
export function isIntroActive() { return active; }
