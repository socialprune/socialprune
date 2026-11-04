export type RowShapeCase = 'extra-line' | 'german-age' | 'unknown-age';
export type ReplyShapeCase = 'time-absent' | 'time-nested' | 'root-changed';
export function rowShapePage(html: string, shape: RowShapeCase) {
  const age =
    shape === 'extra-line'
      ? '2d\\n3 likes'
      : shape === 'german-age'
        ? '2 Std.'
        : '3mo';
  return html.replace(
    "+'\\n'+age)",
    `+'\\n'+${JSON.stringify(age).replace('\\\\n', '\\n')})`,
  );
}
export function replyShapePage(
  html: string,
  id: string,
  shape: ReplyShapeCase,
) {
  if (shape === 'root-changed')
    return html.replace(
      '<div role="button">Reply</div></div></div>',
      '<div role="button">Reply</div></div></div><span data-generated-root-extra></span>',
    );
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
