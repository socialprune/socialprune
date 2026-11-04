export type RowShapeCase = 'extra-line' | 'german-age' | 'unknown-age';
export type ReplyShapeCase = 'time-absent' | 'time-nested' | 'root-changed';
export function rowShapePage(html: string, shape: RowShapeCase) {
  const age =
    shape === 'extra-line'
      ? '2d\\n3 likes'
      : shape === 'german-age'
        ? '2 Std.'
        : '3mo';
  return html
    .replace('<style>', '<style>[data-comment-row]{white-space:pre-line}')
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
