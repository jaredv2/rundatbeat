export function validatePrompt(json) {
  const errors = [];
  if (!json.title || typeof json.title !== 'string') {
    errors.push('title is required');
  }
  if (!Array.isArray(json.restrictions) && !json.restrictions_text) {
    errors.push('restrictions are required');
  }
  return { valid: errors.length === 0, errors };
}
