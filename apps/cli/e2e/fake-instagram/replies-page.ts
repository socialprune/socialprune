/** Generated nested reply group. No real page or content was inspected. */
export function deepReplyRows(
  count: number,
  code: string,
  at: string,
  variant: 'matching' | 'id' | 'time' | 'author' | 'text' = 'matching',
) {
  return Array.from({ length: count }, (_, index) => {
    const author =
      variant === 'author' && index === 0
        ? 'generated_absent'
        : `generated_reply_${index}`;
    const id = 900000 + index + (variant === 'id' && index === 0 ? 100 : 0);
    const time =
      variant === 'time' && index === 0
        ? new Date(Date.parse(at) + 1).toISOString()
        : at;
    const text =
      variant === 'text' && index === 0
        ? 'Generated different visible text'
        : `Generated reply ${index} with local text`;
    return (
      '<div>' +
      '<div>'.repeat(8) +
      `<a href="/${author}/"><img alt="" src="/generated-avatar.png"></a><a href="/${author.toUpperCase()}/">${author}</a><a href="/generated_mention/">@generated_mention</a><span dir="auto">${text}</span><a href="/p/${code}/c/${id}/"><time datetime="${time}">1w</time></a><div role="button">999 likes</div>` +
      '</div>'.repeat(8) +
      '</div>'
    );
  }).join('');
}
export function addRepliesPage(
  html: string,
  count: number,
  id: string,
  code: string,
  at: string,
  label = 'View replies',
  divRows = false,
  adjacentText = false,
  answerRows = false,
) {
  const entries = Array.from({ length: count }, (_, index) => {
    const author = `generated_reply_${index}`;
    return `<li><div><div><span dir="auto"><span><span><div><a href="/${author}/"><div><div><span dir="auto">${author}</span></div></div></a></div></span></span></span><span dir="auto">${index === 1 ? '<span>1w</span>' : `<a href="/p/${code}/c/${900000 + index}/"><time datetime="${at}">1w</time></a>`}</span></div><div><span dir="auto">Generated reply ${index} with local text</span></div></div><div role="button">${index === 1 ? '1.2K likes' : `${index + 2} likes`}</div></li>`;
  }).join('');
  const start = html.indexOf(`/c/${id}/`);
  if (start < 0) throw new Error('Generated focal comment missing');
  const end = html.indexOf('<div role="button">Reply</div></div></div>', start);
  if (end < 0) throw new Error('Generated reply scope missing');
  // The generated ancestry check fixes the group to the permalink's fifth
  // ancestor, outside the inner text/actions row but inside this comment.
  const position = end + '<div role="button">Reply</div></div></div>'.length;
  const rows = answerRows
    ? deepReplyRows(count, code, at)
    : adjacentText
      ? Array.from(
          { length: count },
          (_, index) =>
            `<div><div><a href="/generated_reply_${index}/">generated_reply_${index}</a><span dir="auto">Generated reply ${index} with local text</span><a href="/p/${code}/c/${900000 + index}/"><time datetime="${at}">1w</time></a></div><div role="button">${index + 2} likes</div></div>`,
        ).join('')
      : entries
          .replace(
            '<span>1w</span>',
            `<a href="/p/${code}/c/900001/"><time datetime="${at}">1w</time></a>`,
          )
          .replaceAll('<li>', '<div>')
          .replaceAll('</li>', '</div>');
  const delayed = `const root=this.parentElement;this.remove();setTimeout(()=>mutate(()=>root.insertAdjacentHTML('beforeend',${JSON.stringify(`<div><div><ul>${rows}</ul></div></div><div role="button">${answerRows ? 'Hide all replies' : adjacentText ? 'See replies' : 'Hide replies'}</div>`)})),600)`;
  const group = divRows
    ? `<div role="button" onclick="${delayed.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${label}</div>`
    : `<button onclick="this.nextElementSibling.hidden=false;this.remove()">${label}</button><ul hidden>${entries}</ul>`;
  return (html.slice(0, position) + group + html.slice(position)).replace(
    '</main>',
    "<aside data-reply-decoy><button onclick=\"this.parentElement.setAttribute('data-clicked','true')\">View replies</button></aside></main>",
  );
}
