import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button.tsx';

const MAX_RECORDING_MS = 10 * 60_000;
/**
 * What the browser records, by preference, with the extension the file is uploaded under: the server reads a file's
 * type from its name (Bun ignores the browser's), and `.weba` tells a recording from a `.webm` video. Chrome and
 * Firefox record WebM/Opus, converted by the server to M4A; Safari records M4A.
 */
const FORMATS = [
  { type: 'audio/webm;codecs=opus', extension: 'weba' },
  { type: 'audio/mp4', extension: 'm4a' },
  { type: 'audio/ogg;codecs=opus', extension: 'ogg' },
] as const;

/** "1:05". */
function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type Recording = { recorder: MediaRecorder; startedAt: number };

/**
 * The microphone button: a tap asks for the microphone and records, the stop button (or 10 minutes) ends it, and the
 * recording comes back as a file, to attach to the message being written.
 */
export function VoiceRecorder({
  disabled,
  onRecorded,
  onRecordingChange,
  onError,
}: {
  disabled: boolean;
  onRecorded: (file: File) => void;
  onRecordingChange: (recording: boolean) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [now, setNow] = useState(0);
  // Left mid-recording (another conversation): the microphone is released and nothing is attached.
  const active = useRef<{ recorder: MediaRecorder; discarded: boolean } | null>(null);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(
    () => () => {
      if (!active.current) return;
      active.current.discarded = true;
      active.current.recorder.stop();
    },
    [],
  );

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError(t('voice.unavailable'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const denied =
        error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      onError(t(denied ? 'voice.denied' : 'voice.unavailable'));
      return;
    }
    const format = FORMATS.find((candidate) => MediaRecorder.isTypeSupported(candidate.type));
    const recorder = new MediaRecorder(stream, format ? { mimeType: format.type } : undefined);
    const chunks: Blob[] = [];
    const current = { recorder, discarded: false };
    active.current = current;
    const limit = setTimeout(() => recorder.stop(), MAX_RECORDING_MS);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      clearTimeout(limit);
      for (const track of stream.getTracks()) track.stop();
      active.current = null;
      if (current.discarded) return;
      setRecording(null);
      onRecordingChange(false);
      const type = recorder.mimeType || format?.type || 'audio/webm';
      const extension =
        FORMATS.find((candidate) => type.startsWith(candidate.type.split(';')[0]!))?.extension ?? 'weba';
      const time = new Date().toTimeString().slice(0, 5).replace(':', 'h');
      onRecorded(new File(chunks, `${t('voice.fileName')}-${time}.${extension}`, { type }));
    };
    recorder.start(1000);
    const startedAt = Date.now();
    setNow(startedAt);
    setRecording({ recorder, startedAt });
    onRecordingChange(true);
  }

  if (recording) {
    return (
      <div className='flex shrink-0 items-center gap-2'>
        <span
          role='status'
          className='text-destructive flex items-center gap-1.5 text-sm tabular-nums'
          aria-label={t('voice.recording', { time: clock(now - recording.startedAt), limit: clock(MAX_RECORDING_MS) })}
        >
          <span className='bg-destructive size-2 animate-pulse rounded-full' />
          {clock(now - recording.startedAt)}
        </span>
        <Button
          type='button'
          variant='outline'
          size='icon'
          className='rounded-full'
          onClick={() => recording.recorder.stop()}
          aria-label={t('voice.stop')}
        >
          <Square className='size-3.5 fill-current' />
        </Button>
      </div>
    );
  }
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      className='text-muted-foreground rounded-full'
      disabled={disabled}
      onClick={() => void start()}
      aria-label={t('voice.record')}
    >
      <Mic />
    </Button>
  );
}
