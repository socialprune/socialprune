import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../i18n/index.ts';
import styles from './ClampedText.module.css';

/** Expansion belongs to the text it reveals, never to resized media. */
export function ClampedText({
  children,
  className,
  primary = false,
  caption = false,
  collapsedChildren,
}: {
  children: ReactNode;
  className?: string;
  primary?: boolean;
  caption?: boolean;
  collapsedChildren?: ReactNode;
}) {
  const text = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false),
    [expanded, setExpanded] = useState(false);
  const id = useId(),
    t = useT();
  useLayoutEffect(() => {
    const node = text.current;
    if (!node || expanded) return;
    const measure = () =>
      setClipped(
        !!node.closest('[data-single="true"]') &&
          (node.scrollHeight > node.clientHeight + 1 ||
            node.scrollWidth > node.clientWidth + 1),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children, expanded]);
  return (
    <div
      className={styles.group}
      data-clamped-text
      data-caption-text={caption || undefined}
      data-text-expanded={expanded}
    >
      <p
        ref={text}
        id={id}
        className={`${className ?? ''} ${styles.text}`}
        data-primary-text={primary || undefined}
        dir="auto"
      >
        {!expanded && collapsedChildren !== undefined
          ? collapsedChildren
          : children}
      </p>
      {(clipped || expanded || collapsedChildren !== undefined) && (
        <button
          className={styles.control}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            text.current?.dispatchEvent(
              new CustomEvent('card-text-expansion', {
                bubbles: true,
                detail: next,
              }),
            );
          }}
        >
          {t(
            expanded
              ? 'reviewFeed.collapseText'
              : caption
                ? 'reviewFeed.expandCaption'
                : 'reviewFeed.expandText',
          )}
        </button>
      )}
    </div>
  );
}
