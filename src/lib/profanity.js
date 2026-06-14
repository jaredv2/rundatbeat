// Basic profanity filter — checks against a word list and censors matches
const BLOCKED = [
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'hell', 'crap',
  'dick', 'cock', 'pussy', 'tits', 'boob', 'asshole', 'bastard',
  'slut', 'whore', 'retard', 'nigger', 'faggot', ' tranny',
  'kike', 'spic', 'chink', 'wetback', 'gook',
];

// Build regex once — word boundaries, case-insensitive
const pattern = new RegExp(`\\b(${BLOCKED.join('|')})\\b`, 'gi');

export function containsProfanity(text) {
  if (!text) return false;
  return pattern.test(text);
}

export function censorProfanity(text) {
  if (!text) return text;
  return text.replace(pattern, (match) => '*'.repeat(match.length));
}
