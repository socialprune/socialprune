// Synthetic layout hypotheses only. No account page was read to build these.
export function listNavigationPage(
  mode: 'tiles' | 'dialog' | 'empty',
  german = false,
) {
  const handle = 'generated_handle';
  const text = 'Generated target comment with post context';
  const navRows = [76, 74, 80]
    .map((length, index) => {
      const author = ['generatednav', 'navsix', 'navname'][index]!;
      const value = author + ' ' + 'x'.repeat(length - author.length - 1);
      return `<li><a href="/your_activity/generated_${index}/">${value}</a></li>`;
    })
    .join('');
  const navigation = `<nav role="navigation"><aside><header><div role="tablist"><ul>${navRows}</ul></div></header></aside></nav>`;
  const decorations =
    '<div role="button"><img>abcdefghij</div><div role="button" aria-label="Generated decoration1"><img></div><div role="button" aria-label="Generated decor17"><img></div>';
  const contents =
    mode === 'tiles'
      ? `<div style="height:20px;overflow-y:auto"><div style="height:160px"><a href="/p/Generated_post/"><img><span hidden>${handle} ${text}</span></a><a href="/reel/Generated_reel/"><img></a><a href="/tv/Generated_tv/"><img></a><div role="checkbox"></div></div></div>`
      : mode === 'dialog'
        ? `<div role="dialog"><div role="button" aria-label="Generated comment"><a href="/p/Generated_dialog/"><img></a><span>${handle}</span> ${text} <time datetime="2025-01-02T12:00:00Z">1w</time><div role="checkbox"></div></div></div>`
        : `<p>${german ? 'Keine Ergebnisse' : 'No results'}</p>`;
  return {
    handle,
    text,
    at: '2025-01-02T12:00:00Z',
    html: `<html lang="${german ? 'de' : 'en'}"><body><main>${navigation}<div role="button" aria-label="test comment8">test comment8</div>${mode === 'dialog' ? '' : contents}</main>${mode === 'dialog' ? contents : ''}${decorations}</body></html>`,
  };
}
