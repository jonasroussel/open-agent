import {
  API_ROUTES,
  apiPath,
  MAX_PROMPT_LENGTH,
  missingCapabilities,
  MODEL_ROLES,
  PROMPT_NAMES,
  type ModelInfoDto,
  type ModelRole,
  type PromptName,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { api, type ApiErrorCode } from '@/lib/api.ts';
import { usePageTitle } from '@/shell/page-title.tsx';

import { adminModelsQuery, adminSettingsQuery } from './admin-settings-query.ts';
import { ModelList, price } from './model-list.tsx';

/** "Settings", for the admin: the model of each role and the three prompts, changed without a restart. */
export function AdminSettingsPage() {
  const { t } = useTranslation();
  usePageTitle(t('settings.title'));
  const settings = useQuery(adminSettingsQuery);
  const models = useQuery(adminModelsQuery);

  return (
    <div className='mx-auto grid w-full max-w-3xl gap-10 px-4 pt-6 pb-12 md:px-8'>
      <section className='grid gap-4'>
        <div className='grid gap-1'>
          <h2 className='text-lg font-semibold'>{t('settings.models')}</h2>
          <p className='text-muted-foreground text-sm'>{t('settings.modelsDescription')}</p>
        </div>
        {settings.isError && <AlertMessage text={t('errors.network')} />}
        <ul className='divide-y rounded-lg border'>
          {settings.data &&
            MODEL_ROLES.map((role) => (
              <ModelRow
                key={role}
                role={role}
                modelId={settings.data.models[role]}
                isDefault={settings.data.models[role] === settings.data.defaultModels[role]}
                info={models.data?.find((model) => model.id === settings.data.models[role]) ?? null}
              />
            ))}
        </ul>
      </section>

      <section className='grid gap-4'>
        <div className='grid gap-1'>
          <h2 className='text-lg font-semibold'>{t('settings.prompts')}</h2>
          <p className='text-muted-foreground text-sm'>{t('settings.promptsDescription')}</p>
        </div>
        {settings.data &&
          PROMPT_NAMES.map((name) => (
            <PromptEditor
              key={name}
              name={name}
              text={settings.data.prompts[name]}
              defaultText={settings.data.defaultPrompts[name]}
            />
          ))}
      </section>
    </div>
  );
}

function ModelRow({
  role,
  modelId,
  isDefault,
  info,
}: {
  role: ModelRole;
  modelId: string;
  isDefault: boolean;
  info: ModelInfoDto | null;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);

  return (
    <li className='flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3'>
      <div className='grid min-w-0 flex-1 gap-0.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium'>{t(`settings.role.${role}`)}</span>
          <Badge variant={isDefault ? 'outline' : 'secondary'}>
            {isDefault ? t('settings.default') : t('settings.changed')}
          </Badge>
        </div>
        <span className='text-muted-foreground text-sm'>{t(`settings.roleDescription.${role}`)}</span>
        <span className='truncate font-mono text-xs'>{modelId}</span>
        {info && <span className='text-muted-foreground text-xs'>{price(info)}</span>}
      </div>
      <Button variant='outline' onClick={() => setPicking(true)}>
        {t('settings.change')}
      </Button>
      <ModelPicker role={role} current={modelId} open={picking} onClose={() => setPicking(false)} />
    </li>
  );
}

/** OpenRouter's models that can take the role, cheapest first, with a search. */
function ModelPicker({
  role,
  current,
  open,
  onClose,
}: {
  role: ModelRole;
  current: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const suitable = (model: ModelInfoDto) => missingCapabilities(role, model.capabilities).length === 0;

  async function choose(id: string) {
    setSaving(id);
    const result = await api(apiPath(API_ROUTES.adminModel, { role }), { method: 'PUT', body: { modelId: id } });
    setSaving(null);
    if (!result.ok) return setError(result.error);
    await queryClient.invalidateQueries({ queryKey: adminSettingsQuery.queryKey });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent onOpenAutoFocus={() => setError(null)} className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('settings.pickTitle', { role: t(`settings.role.${role}`) })}</DialogTitle>
          <DialogDescription>{t(`settings.requirement.${role}`)}</DialogDescription>
        </DialogHeader>
        <ModelList suitable={suitable} current={current} disabled={saving !== null} onChoose={(id) => void choose(id)}>
          {error && <AlertMessage text={t(`errors.${error}`)} />}
        </ModelList>
      </DialogContent>
    </Dialog>
  );
}

/** One prompt: edited in place, saved for the next messages, and brought back to the code's text. */
function PromptEditor({ name, text, defaultText }: { name: PromptName; text: string; defaultText: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(value: string | null) {
    const result = await api(apiPath(API_ROUTES.adminPrompt, { name }), { method: 'PUT', body: { text: value } });
    if (!result.ok) return setError(result.error);
    setError(null);
    // A reset shows the original text right away.
    setDraft(value ?? defaultText);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await queryClient.invalidateQueries({ queryKey: adminSettingsQuery.queryKey });
  }

  return (
    <div className='grid gap-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='font-medium'>{t(`settings.prompt.${name}`)}</h3>
        <Badge variant={text === defaultText ? 'outline' : 'secondary'}>
          {text === defaultText ? t('settings.default') : t('settings.changed')}
        </Badge>
      </div>
      <p className='text-muted-foreground text-sm'>{t(`settings.promptDescription.${name}`)}</p>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={MAX_PROMPT_LENGTH}
        aria-label={t(`settings.prompt.${name}`)}
        className='max-h-[32rem] min-h-48 font-mono text-xs leading-relaxed'
      />
      {error && <AlertMessage text={t(`errors.${error}`)} />}
      <div className='flex flex-wrap items-center justify-end gap-2'>
        {saved && <span className='text-muted-foreground text-sm'>{t('settings.saved')}</span>}
        {text !== defaultText && (
          <Button variant='ghost' onClick={() => void save(null)}>
            <RotateCcw />
            {t('settings.reset')}
          </Button>
        )}
        <Button disabled={draft.trim() === text.trim() || !draft.trim()} onClick={() => void save(draft)}>
          {t('settings.save')}
        </Button>
      </div>
    </div>
  );
}
