import {
  API_ROUTES,
  apiPath,
  commandNameOf,
  MAX_COMMAND_NAME_LENGTH,
  MAX_COMMAND_PROMPT_LENGTH,
  type CommandBody,
  type CommandDto,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, SquareSlash, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { api, type ApiErrorCode } from '@/lib/api.ts';
import { usePageTitle } from '@/shell/page-title.tsx';

import { commandsQuery } from './commands-query.ts';

type Changed = (result: { ok: true } | { ok: false; error: ApiErrorCode }) => Promise<boolean>;

/** "My commands": the requests the user runs with `/name`, to read, add, rewrite or delete. */
export function CommandsPage() {
  const { t } = useTranslation();
  usePageTitle(t('commands.title'));
  const queryClient = useQueryClient();
  const commands = useQuery(commandsQuery);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  const changed: Changed = async (result) => {
    setError(result.ok ? null : result.error);
    await queryClient.invalidateQueries({ queryKey: commandsQuery.queryKey });
    return result.ok;
  };

  return (
    <div className='mx-auto grid w-full max-w-3xl gap-6 px-4 pt-6 pb-12 md:px-8'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <p className='text-muted-foreground max-w-xl'>{t('commands.description')}</p>
        {!adding && (
          <Button size='lg' onClick={() => setAdding(true)}>
            <Plus />
            {t('commands.add')}
          </Button>
        )}
      </div>
      {error && <AlertMessage text={t(`errors.${error}`)} />}

      {adding && (
        <CommandForm
          onCancel={() => setAdding(false)}
          onSave={async (body) => {
            const saved = await changed(await api(API_ROUTES.commands, { method: 'POST', body }));
            if (saved) setAdding(false);
          }}
        />
      )}

      {commands.isError && <AlertMessage text={t('errors.network')} />}
      {commands.data?.length === 0 && !adding && (
        <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center'>
          <SquareSlash className='size-6' />
          <p>{t('commands.empty')}</p>
        </div>
      )}
      {commands.data && commands.data.length > 0 && (
        <ul className='divide-y rounded-lg border'>
          {commands.data.map((command) => (
            <CommandRow key={command.id} command={command} onChanged={changed} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CommandRow({ command, onChanged }: { command: CommandDto; onChanged: Changed }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const path = apiPath(API_ROUTES.command, { commandId: command.id });

  if (editing) {
    return (
      <li className='p-3'>
        <CommandForm
          initial={command}
          onCancel={() => setEditing(false)}
          onSave={async (body) => {
            if (await onChanged(await api(path, { method: 'PATCH', body }))) setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className='hover:bg-muted/60 flex items-start gap-3 px-4 py-3'>
      <SquareSlash className='text-secondary-foreground mt-1 size-4 shrink-0' />
      <div className='grid min-w-0 flex-1 gap-1'>
        <span className='font-medium'>/{command.name}</span>
        <p className='text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap'>{command.prompt}</p>
        <span className='text-muted-foreground text-xs'>
          {command.uses > 0 ? t('commands.uses', { count: command.uses }) : t('commands.unused')}
        </span>
      </div>
      <Button
        variant='ghost'
        size='icon'
        aria-label={t('commands.edit', { name: command.name })}
        title={t('commands.edit', { name: command.name })}
        onClick={() => setEditing(true)}
      >
        <Pencil />
      </Button>
      <Button
        variant='ghost'
        size='icon'
        aria-label={t('commands.delete', { name: command.name })}
        title={t('commands.delete', { name: command.name })}
        onClick={() => void api(path, { method: 'DELETE' }).then(onChanged)}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/** A name to type after `/`, shown as it will be, and the prompt the model gets. */
function CommandForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: CommandDto;
  onSave: (body: CommandBody) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [saving, setSaving] = useState(false);
  const cleanName = commandNameOf(name);
  const valid = cleanName !== null && prompt.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    await onSave({ name: cleanName, prompt: prompt.trim() });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className='grid gap-3 rounded-lg border p-3'>
      <label className='grid gap-1.5'>
        <span className='text-sm font-medium'>{t('commands.name')}</span>
        <div className='flex items-center gap-1'>
          <span className='text-muted-foreground'>/</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => cleanName && setName(cleanName)}
            placeholder={t('commands.namePlaceholder')}
            maxLength={MAX_COMMAND_NAME_LENGTH + 2}
            autoFocus
            className='h-10 px-3 text-base'
          />
        </div>
      </label>
      <label className='grid gap-1.5'>
        <span className='text-sm font-medium'>{t('commands.prompt')}</span>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('commands.promptPlaceholder')}
          maxLength={MAX_COMMAND_PROMPT_LENGTH}
          className='field-sizing-content max-h-72 min-h-24 text-base'
        />
      </label>
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' onClick={onCancel}>
          {t('commands.cancel')}
        </Button>
        <Button type='submit' disabled={!valid || saving}>
          {t('commands.save')}
        </Button>
      </div>
    </form>
  );
}
