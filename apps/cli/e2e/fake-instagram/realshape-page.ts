export type RowShapeCase =
  'extra-line' | 'german-age' | 'unknown-age' | 'handle-only';
export type ReplyShapeCase =
  | 'time-absent'
  | 'time-nested'
  | 'root-changed'
  | 'structural'
  | 'top-level-decoy';
export function rowShapePage(html: string, shape: RowShapeCase) {
  if (shape === 'handle-only')
    return html
      .replace('<style>', '<style>#list>[role=button]{white-space:pre-line}')
      .replace(
        'list.replaceChildren();',
        `list.replaceChildren();const empty=document.createElement('div');empty.setAttribute('role','button');empty.setAttribute('aria-label','Generated empty comment');empty.innerHTML='<img src="/thumb.png" alt="">';empty.append(document.createTextNode(handle+'\\n18w'));list.append(empty);`,
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
