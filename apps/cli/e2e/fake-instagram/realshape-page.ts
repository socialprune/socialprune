export type RowShapeCase =
  | 'extra-line'
  | 'german-age'
  | 'unknown-age'
  | 'handle-only'
  // ROW-TRAIL-1: generated trailing lines. `target` appends the line(s) after
  // every row's age; `decoy` adds one own row with another text and the line(s)
  // after its age; `before` puts the line(s) between that row's text and age.
  | `trailing-${'target' | 'decoy' | 'before'}:${string}`;
export type ReplyShapeCase =
  | 'time-absent'
  | 'time-nested'
  | 'root-changed'
  | 'structural'
  | 'no-replies'
  | 'plain-zero'
  | 'plain-zero-expand'
  | 'plain-zero-permalink'
  | 'plain-zero-forty-middle'
  | 'plain-zero-forty-end'
  | 'plain-zero-forty-permalink'
  | 'plain-zero-forty-no-foreign'
  | 'plain-zero-forty-two-focal'
  | 'plain-zero-forty-anchor'
  | 'plain-zero-over-bound'
  | 'plain-zero-over-elements'
  | 'nonzero-forty'
  | 'sole-zero'
  | 'sole-zero-control'
  | 'sole-zero-permalink'
  | 'sole-zero-reply'
  | 'sole-zero-own-reply'
  | 'sole-zero-own-foreign'
  | 'sole-zero-own-expand'
  | 'sole-zero-own-time'
  | 'sole-zero-post-time'
  | 'sole-zero-other-post-time'
  | 'sole-zero-unlinked-time'
  | 'sole-zero-counter'
  | 'sole-zero-counter-text'
  | 'sole-zero-inner-counter'
  | 'sole-zero-caption-time'
  | 'sole-zero-caption-time-mismatch'
  | 'sole-zero-caption-time-in-row'
  | 'sole-zero-caption-time-other-comment'
  | 'sole-zero-caption-time-control'
  | 'top-level-decoy';
/** The generated caption object's time, as the fake answer states it. */
export const SOLE_CAPTION_TIME = '2024-12-31T00:00:00.000Z';
export function rowShapePage(html: string, shape: RowShapeCase) {
  const trailing = /^trailing-(target|decoy|before):([\s\S]+)$/u.exec(shape);
  if (trailing) {
    const [, mode, line] = trailing;
    // `@handle` stands for the generated signed-in handle as the trailing line.
    const tail =
      line === '@handle' ? "'\\n'+handle" : JSON.stringify('\n' + line);
    const styled = html.replace(
      '<style>',
      '<style>#list>[role=button]{white-space:pre-line}',
    );
    if (mode === 'target') {
      const anchor = "+'\\n'+age)";
      if (!styled.includes(anchor))
        throw new Error('Generated trailing-line anchor missing');
      return styled.replace(anchor, `+'\\n'+age+${tail})`);
    }
    const text =
      mode === 'decoy'
        ? `' Generated decoy comment\\n1w'+${tail}`
        : `' Generated decoy comment'+${tail}+'\\n1w'`;
    const anchor = 'list.replaceChildren();';
    if (!styled.includes(anchor))
      throw new Error('Generated decoy-row anchor missing');
    return styled.replace(
      anchor,
      `${anchor}const decoyNode=document.createElement('div');decoyNode.setAttribute('role','button');decoyNode.setAttribute('aria-label','Generated decoy row');decoyNode.innerHTML='<img src="/thumb.png" alt="">';decoyNode.append(document.createTextNode(handle+${text}));list.append(decoyNode);`,
    );
  }
  if (shape === 'handle-only')
    return html
      .replace('<style>', '<style>#list>[role=button]{white-space:pre-line}')
      .replace(
        'list.replaceChildren();',
        `list.replaceChildren();const handleOnlyNode=document.createElement('div');handleOnlyNode.setAttribute('role','button');handleOnlyNode.setAttribute('aria-label','Generated empty comment');handleOnlyNode.innerHTML='<img src="/thumb.png" alt="">';handleOnlyNode.append(document.createTextNode(handle+'\\n18w'));list.append(handleOnlyNode);`,
      );
  const age =
    shape === 'extra-line'
      ? '2d\\n3 likes'
      : shape === 'german-age'
        ? '2 Std.'
        : '3mo';
  return html
    .replace('<style>', '<style>#list>[role=button]{white-space:pre-line}')
    .replace(
      "+'\\n'+age)",
      `+'\\n'+${JSON.stringify(age).replace('\\\\n', '\\n')})`,
    );
}
export function replyShapePage(
  html: string,
  id: string,
  shape: ReplyShapeCase,
) {
  if (shape === 'nonzero-forty') {
    const siblings = Array.from(
      { length: 39 },
      (_, index) =>
        `<div><a href="/p/Generated/c/${777000 + index}/"><time datetime="2025-01-01T00:00:00Z">1w</time></a><div role="button">View all 2 replies</div></div>`,
    ).join('');
    return html.replace(
      '<div id="comment-rows">',
      '<div id="comment-rows">' + siblings,
    );
  }
  if (
    shape === 'no-replies' ||
    shape.startsWith('plain-zero') ||
    shape.startsWith('sole-zero')
  ) {
    const stack: { name: string; start: number }[] = [];
    let start = -1,
      end = -1;
    for (const token of html
      .slice(0, html.indexOf('<script>'))
      .matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu)) {
      const [tag, name] = token;
      if (tag.startsWith('</')) {
        const index = stack.findLastIndex((node) => node.name === name);
        if (index >= 0) {
          if (stack[index]!.start === start) {
            end = token.index + tag.length;
            break;
          }
          stack.splice(index);
        }
      } else {
        if (tag.includes(`/c/${id}/`)) start = stack.at(-7)?.start ?? -1;
        if (!['img', 'meta', 'link', 'input', 'br', 'hr'].includes(name!))
          stack.push({ name: name!, start: token.index });
      }
    }
    if (start < 0 || end < 0)
      throw new Error('Generated empty reply scope missing');
    const focal = html
      .slice(start, end)
      .replace('<div role="button">Reply</div>', '');
    if (shape.startsWith('sole-zero')) {
      const local =
        shape === 'sole-zero-control' ||
        shape === 'sole-zero-caption-time-control'
          ? '<div role="button">View replies</div>'
          : shape === 'sole-zero-reply' || shape.startsWith('sole-zero-own-')
            ? '<div role="button">Reply</div>'
            : shape === 'sole-zero-permalink'
              ? '<a href="/p/Generated/c/888888/"><time datetime="2025-01-01T00:00:00Z">1w</time></a>'
              : shape === 'sole-zero-counter'
                ? '<div role="button">View all 2 replies</div>'
                : shape === 'sole-zero-counter-text'
                  ? '<span>View all 2 replies</span>'
                  : '';
      // A second time sits inside the isolated focal item, as the caption
      // date does when Instagram renders it beside the only comment.
      const post = new RegExp(`href="(/(?:p|reel)/[^/"]+/)c/${id}/"`).exec(
        html,
      )?.[1];
      if (!post) throw new Error('Generated sole post address missing');
      const innerTime =
        shape === 'sole-zero-post-time'
          ? `<a href="${post}"><time datetime="2024-12-31T00:00:00Z">2w</time></a>`
          : shape === 'sole-zero-other-post-time'
            ? '<a href="/p/GeneratedOther/"><time datetime="2024-12-31T00:00:00Z">2w</time></a>'
            : shape === 'sole-zero-unlinked-time'
              ? '<span><time datetime="2025-01-02T00:00:00Z">Edited</time></span>'
              : shape === 'sole-zero-inner-counter'
                ? '<div role="button">View all 2 replies</div>'
                : shape === 'sole-zero-caption-time-in-row'
                  ? `<span><time datetime="${SOLE_CAPTION_TIME}">2w</time></span>`
                  : '';
      // The real 2026-11-08 shape (run 0af2d0ac step 0): beside the focal
      // comment, a sibling with an image and one time without any link, and
      // an empty sibling. The time is the caption's when its datetime equals
      // the caption object's time; the other-comment row's time does not.
      const caption = shape.startsWith('sole-zero-caption-time');
      const sibling =
        shape === 'sole-zero-caption-time' ||
        shape === 'sole-zero-caption-time-control'
          ? `<div><img src="/profiles/owner.png" alt=""><span>Generated caption</span><span><time datetime="${SOLE_CAPTION_TIME}">2w</time></span></div>`
          : shape === 'sole-zero-caption-time-mismatch'
            ? '<div><img src="/profiles/owner.png" alt=""><span>Generated caption</span><span><time datetime="2024-12-31T00:00:01.000Z">2w</time></span></div>'
            : shape === 'sole-zero-caption-time-other-comment'
              ? '<div><img src="/profiles/comment.png" alt=""><a href="/generated_other/">generated_other</a><span>Generated other comment</span><span><time datetime="2025-01-05T00:00:00.000Z">3d</time></span></div>'
              : '<img src="/profiles/comment.png" alt="">';
      const list = html.indexOf('<div id="comment-rows">');
      if (list < 0) throw new Error('Generated sole comment list missing');
      return (
        html
          .slice(0, html.indexOf('>', list) + 1)
          .replace(
            '<main>',
            `<main>${shape === 'sole-zero-reply' || shape === 'sole-zero-own-foreign' ? '<button>Reply</button>' : ''}`,
          ) +
        `<div>${sibling}<div></div><div>` +
        // Caption shapes put the three siblings at scope level 12, as on the
        // real page; the control there sits outside that level, in the page.
        '<div>'.repeat(caption ? 3 : 8) +
        focal +
        innerTime +
        '</div>'.repeat(caption ? 3 : 8) +
        '</div>' +
        (shape === 'sole-zero-reply' || caption ? '' : local) +
        (shape === 'sole-zero-own-expand'
          ? '<div role="button">Hide replies</div>'
          : shape === 'sole-zero-own-time'
            ? '<time datetime="2025-01-01T00:00:00Z">1w</time>'
            : '') +
        '</div>' +
        (caption ? local : '') +
        html.slice(end)
      );
    }
    if (shape.startsWith('plain-zero')) {
      if (
        shape.startsWith('plain-zero-forty') ||
        shape.startsWith('plain-zero-over-')
      ) {
        const total = shape === 'plain-zero-over-bound' ? 513 : 40;
        const focalIndex = shape === 'plain-zero-forty-end' ? 38 : 20;
        const block =
          '<div><div><div>' +
          focal +
          '</div></div>' +
          (shape === 'plain-zero-forty-permalink'
            ? '<a href="/p/Generated/c/888888/"><time datetime="2025-01-01T00:00:00Z">1w</time></a>'
            : '') +
          '</div>';
        const siblings = Array.from({ length: total }, (_, index) => {
          if (
            index === focalIndex ||
            (shape === 'plain-zero-forty-two-focal' && index === 39)
          )
            return block;
          if (shape === 'plain-zero-forty-no-foreign')
            return '<div><span>Generated empty sibling</span></div>';
          const link = `<a href="/p/Generated/c/${777000 + index}/"><time datetime="2025-01-01T00:00:00Z">1w</time></a>`;
          return shape === 'plain-zero-forty-anchor' && index === 39
            ? link
            : `<div>${link}<img src="/profiles/comment.png" alt=""><div role="button">View all 2 replies</div>${shape === 'plain-zero-over-elements' && index === 0 ? '<span></span>'.repeat(20001) : ''}</div>`;
        }).join('');
        return (
          html.slice(0, start) +
          '<div><div>' +
          siblings +
          '</div></div>' +
          html.slice(end)
        );
      }
      const siblings = Array.from(
        { length: 9 },
        (_, index) =>
          `<div><a href="/p/Generated/c/${777000 + index}/"><time datetime="2025-01-01T00:00:00Z">1w</time></a>${index % 2 === 0 ? '<div role="button">View all 2 replies</div>' : ''}</div>`,
      ).join('');
      const local =
        shape === 'plain-zero-expand'
          ? '<div role="button">View all 1 replies</div>'
          : shape === 'plain-zero-permalink'
            ? '<a href="/p/Generated/c/888888/"><time datetime="2025-01-01T00:00:00Z">1w</time></a>'
            : '';
      return (
        html.slice(0, start) +
        '<div><div><div>' +
        '<div><div>' +
        focal +
        '</div></div>' +
        local +
        '</div>' +
        siblings +
        '</div></div>' +
        html.slice(end)
      );
    }
    return (
      html.slice(0, start) +
      '<div><div><div>' +
      focal +
      '</div></div></div>' +
      html.slice(end)
    );
  }
  if (shape === 'structural' || shape === 'top-level-decoy') {
    // Preserve the independently stated real counts: no avatar link, two
    // children at the old root's parent and two divs at the old outer.
    const stack: { name: string; position: number }[] = [];
    let parent = -1,
      outer = -1;
    for (const token of html
      .slice(0, html.indexOf('<script>'))
      .matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu)) {
      const [tag, name] = token;
      if (tag.startsWith('</')) {
        const index = stack.findLastIndex((node) => node.name === name);
        if (index >= 0) stack.splice(index);
        continue;
      }
      if (tag.includes(`/c/${id}/`)) {
        parent = stack.at(-6)?.position ?? -1;
        outer = stack.at(-7)?.position ?? -1;
        break;
      }
      if (!['img', 'meta', 'link', 'input', 'br', 'hr'].includes(name!))
        stack.push({ name: name!, position: token.index });
    }
    if (parent < 0 || outer < 0)
      throw new Error('Generated structural root missing');
    const insert = (source: string, position: number, content: string) => {
      const end = source.indexOf('>', position) + 1;
      return source.slice(0, end) + content + source.slice(end);
    };
    let result = insert(html, parent, '<span data-generated-sibling></span>');
    result = insert(result, outer, '<div data-generated-outer></div>');
    result = result.replace(
      /<a href="\/[A-Za-z0-9_.]+\/"><img src="\/profiles\/comment.png" alt=""><\/a>/gu,
      '<img src="/profiles/comment.png" alt="">',
    );
    if (shape === 'top-level-decoy')
      result = result.replace(
        '<button onclick="this.nextElementSibling.hidden=false;this.remove()">View replies',
        '<div><a href="/p/Generated/c/777777/"><time datetime="2025-01-01T00:00:00Z">1w</time></a></div><button onclick="this.nextElementSibling.hidden=false;this.remove()">View replies',
      );
    return result;
  }
  if (shape === 'root-changed') {
    const stack: { name: string; position: number }[] = [];
    let parent = -1;
    for (const token of html
      .slice(0, html.indexOf('<script>'))
      .matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu)) {
      const [tag, name] = token;
      if (tag.startsWith('</')) {
        const index = stack.findLastIndex((node) => node.name === name);
        if (index >= 0) stack.splice(index);
        continue;
      }
      if (tag.includes(`/c/${id}/`)) {
        parent = stack.at(-6)?.position ?? -1;
        break;
      }
      if (!['img', 'meta', 'link', 'input', 'br', 'hr'].includes(name!))
        stack.push({ name: name!, position: token.index });
    }
    if (parent < 0) throw new Error('Generated focal parent missing');
    const end = html.indexOf('>', parent) + 1;
    return (
      html.slice(0, end) +
      '<span data-generated-root-extra></span>' +
      html.slice(end)
    );
  }
  const pattern = new RegExp(
    `(<a href="/p/[A-Za-z0-9_-]+/c/${id}/">)(<time datetime="[^"]+">[^<]*</time>)(</a>)`,
  );
  return html.replace(
    pattern,
    (_whole: string, open: string, time: string, close: string) =>
      shape === 'time-absent'
        ? `${open}1w${close}`
        : `${open}1w${close}${time}`,
  );
}
