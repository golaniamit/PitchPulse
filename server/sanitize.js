// Defensive stripping of HTML-like content from free-text fields.
// React escapes text children on render today — this is belt-and-braces for
// any future surface (email, PDF export, rich preview) that might render raw.
function stripTags(s) {
  if (typeof s !== 'string') return s;
  // Remove anything that looks like an HTML tag, including unclosed ones.
  // Collapse runs of whitespace introduced by the strip.
  return s.replace(/<[^>]*>?/g, '').replace(/\s{2,}/g, ' ').trim();
}

module.exports = { stripTags };
