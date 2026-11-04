import { createElement, lazy, useEffect, useState, type ComponentProps } from 'react';

// Type only: erased from the build, so the renderer's chunk stays separate.
import type MarkdownRenderer from './markdown.tsx';

/** The Markdown renderer (Streamdown, about 155 kB gzipped): its own chunk, so the sign-in page loads without it. */
const loadMarkdown = () => import('./markdown.tsx');

type Renderer = typeof MarkdownRenderer;

const LazyMarkdown = lazy(loadMarkdown);
let renderer: Renderer | null = null;
let loading: Promise<void> | null = null;

/** Started by the app shell as soon as it shows: the chunk is usually there before the first message. */
export function preloadMarkdown(): Promise<void> {
  loading ??= loadMarkdown().then((module) => {
    renderer = module.default;
  });
  return loading;
}

/**
 * The renderer itself once loaded. Through `lazy` it would suspend on its first render all the same, and React keeps a
 * fallback at least 300 ms: answers showed as plain text, then changed height.
 */
export function Markdown(props: ComponentProps<Renderer>) {
  return createElement(renderer ?? LazyMarkdown, props);
}

/**
 * Whether the renderer is there: a conversation waits for it to show its messages once, as Markdown, instead of as
 * plain text that then changes height.
 */
export function useMarkdownReady(): boolean {
  const [ready, setReady] = useState(renderer !== null);
  useEffect(() => {
    if (!ready) void preloadMarkdown().then(() => setReady(true));
  }, [ready]);
  return ready;
}
