/** Generated nested reply group. No real page or content was inspected. */
export function addRepliesPage(
  html: string,
  count: number,
  id: string,
  code: string,
  at: string,
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
  const group = `<button onclick="this.nextElementSibling.hidden=false;this.remove()">View replies</button><ul hidden>${entries}</ul>`;
  return (html.slice(0, position) + group + html.slice(position)).replace(
    '</main>',
    "<aside data-reply-decoy><button onclick=\"this.parentElement.setAttribute('data-clicked','true')\">View replies</button></aside></main>",
  );
}
