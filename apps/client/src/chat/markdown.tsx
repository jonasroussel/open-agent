import { code } from '@streamdown/code';
import { Streamdown } from 'streamdown';

const plugins = { code };

/** Its own chunk (Markdown parsing and code highlighting are heavy): the app shell loads without it. */
export default function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Streamdown
      plugins={plugins}
      isAnimating={streaming}
      className='text-[15px] leading-relaxed [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h4]:text-base'
    >
      {text}
    </Streamdown>
  );
}
