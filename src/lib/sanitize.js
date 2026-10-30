import sanitizeHtml from 'sanitize-html';

/** Cleans editor HTML before it is stored, so only simple formatting survives. */
export function cleanRichText(html) {
  const clean = sanitizeHtml(String(html || ''), {
    allowedTags: ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 'del', 's', 'a', 'h2', 'h3', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'hr'],
    allowedAttributes: { a: ['href', 'rel', 'target'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      // the page title is the only h1, so editor headings become h2
      h1: 'h2',
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          href: attribs.href,
          ...(/^https?:/i.test(attribs.href || '') ? { rel: 'noopener', target: '_blank' } : {}),
        },
      }),
    },
    exclusiveFilter: (frame) => frame.tag === 'a' && !frame.attribs.href,
  });
  return splitParagraphs(clean).trim();
}

/**
 * The editor marks a new line with <br>. In a plain paragraph, treat each
 * line as its own paragraph so pressing Return gives proper spacing.
 */
function splitParagraphs(html) {
  return html.replace(/<(p|div)>([\s\S]*?)<\/\1>/g, (_, tag, inner) =>
    inner.split(/(?:<br\s*\/?>\s*)+/)
      .map((part) => part.trim())
      .filter((part) => part && part !== '&nbsp;')
      .map((part) => `<p>${part}</p>`)
      .join(''));
}
