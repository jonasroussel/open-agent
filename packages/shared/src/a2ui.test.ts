import { describe, expect, test } from 'bun:test';

import { A2UI_MAX_COMPONENTS, normalizeBindingKeys, resolveBindings, validateSurface, writePath } from './a2ui.ts';

const SHOPPING = {
  title: 'Courses',
  components: [
    { id: 'root', component: 'Column', children: ['title', 'card', 'send'] },
    { id: 'title', component: 'Text', text: 'Pour **samedi**', variant: 'heading' },
    { id: 'card', component: 'Card', child: 'list' },
    {
      id: 'list',
      component: 'Checklist',
      items: [
        { id: 'eggs', label: 'Œufs' },
        { id: 'milk', label: 'Lait' },
      ],
      checked: { '@path': '/checked' },
    },
    { id: 'send', component: 'Button', label: 'Une recette ?', message: 'Une recette avec ça ?' },
  ],
  dataModel: { checked: { eggs: true } },
};

const withComponents = (components: unknown[]) => ({ ...SHOPPING, components });
const errorOf = (surface: unknown, purpose?: 'show' | 'ask') => {
  const result = validateSurface(surface, purpose);
  return result.ok ? null : result.error;
};

describe('validateSurface', () => {
  test('a valid surface passes', () => {
    expect(validateSurface(SHOPPING)).toEqual({ ok: true });
  });

  test('an unknown component is named, with the catalog', () => {
    const error = errorOf(withComponents([{ id: 'root', component: 'Slider' }]));
    expect(error).toContain('unknown component "Slider"');
    expect(error).toContain('Checklist');
  });

  test('a missing child is named', () => {
    expect(errorOf(withComponents([{ id: 'root', component: 'Card', child: 'ghost' }]))).toBe(
      '"root" names a child "ghost" that does not exist.',
    );
  });

  test('a cycle is refused', () => {
    const error = errorOf(
      withComponents([
        { id: 'root', component: 'Column', children: ['x'] },
        { id: 'x', component: 'Divider' },
        { id: 'a', component: 'Card', child: 'b' },
        { id: 'b', component: 'Card', child: 'a' },
      ]),
    );
    expect(error).toContain('cycle');
  });

  test('a duplicate id is refused', () => {
    const error = errorOf(
      withComponents([
        { id: 'root', component: 'Column', children: ['a'] },
        { id: 'a', component: 'Divider' },
        { id: 'a', component: 'Divider' },
      ]),
    );
    expect(error).toContain('Duplicate id "a"');
  });

  test('root comes first, and every component is reachable from it', () => {
    expect(errorOf(withComponents([{ id: 'top', component: 'Divider' }]))).toContain('"root"');
    expect(
      errorOf(
        withComponents([
          { id: 'root', component: 'Divider' },
          { id: 'lost', component: 'Divider' },
        ]),
      ),
    ).toContain('"lost" is not reachable');
  });

  test('a surface too big is refused', () => {
    const many = Array.from({ length: A2UI_MAX_COMPONENTS + 1 }, (_, index) => ({
      id: `t${index}`,
      component: 'Divider',
    }));
    expect(errorOf(withComponents(many))).toContain('Too many components');
    const long = withComponents([{ id: 'root', component: 'Text', text: 'x'.repeat(25_000) }]);
    expect(errorOf(long)).toContain('too big');
  });

  test('props are checked, with the path of the mistake', () => {
    const error = errorOf(withComponents([{ id: 'root', component: 'Checklist', items: [], checked: 'done' }]));
    expect(error).toContain('components[0] "root": items');
    expect(error).toContain('checked');
    expect(errorOf(withComponents([{ id: 'root', component: 'Image', url: 'https://example.com/cat.png' }]))).toContain(
      '/api/files/<id>',
    );
  });

  test('a question answers with events and may hold a text field; a shown surface sends messages', () => {
    const question = {
      components: [
        { id: 'root', component: 'Column', children: ['q', 'other', 'send'] },
        { id: 'q', component: 'Text', text: 'Mer ou montagne ?' },
        { id: 'other', component: 'TextField', value: { '@path': '/answer' } },
        {
          id: 'send',
          component: 'Button',
          label: 'Envoyer',
          action: { event: { name: 'send', context: { answer: { '@path': '/answer' } } } },
        },
      ],
    };
    expect(validateSurface(question, 'ask')).toEqual({ ok: true });
    expect(errorOf(question, 'show')).toContain('unknown component "TextField"');
    expect(errorOf(SHOPPING, 'ask')).toContain('must answer the question');
  });
});

describe('resolveBindings', () => {
  test('bindings take the data model’s values, anywhere in the value; a missing path is null', () => {
    const dataModel = { answer: 'Mer', picked: ['a', 'b'], deep: { 'a/b': 1 } };
    expect(
      resolveBindings(
        {
          answer: { '@path': '/answer' },
          first: { '@path': '/picked/0' },
          list: [{ '@path': '/deep/a~1b' }],
          none: { '@path': '/nope' },
          fixed: 3,
        },
        dataModel,
      ),
    ).toEqual({ answer: 'Mer', first: 'a', list: [1], none: null, fixed: 3 });
  });

  test('writePath sets a value without changing the original', () => {
    const before = { checked: { eggs: true } };
    expect(writePath(before, '/checked/milk', true)).toEqual({ checked: { eggs: true, milk: true } });
    expect(before).toEqual({ checked: { eggs: true } });
  });
});

describe('normalizeBindingKeys', () => {
  test('a binding key written with its quotes becomes @path again, at any depth; other keys stay', () => {
    const written = withComponents([
      { id: 'root', component: 'Checklist', items: [{ id: 'a', label: 'A' }], checked: { " '@path' ": '/checked' } },
      {
        id: 'send',
        component: 'Button',
        label: 'OK',
        action: { event: { name: 'ok', context: { x: { '"@path"': '/x' } } } },
      },
    ]);
    const normalized = normalizeBindingKeys(written);
    expect(normalized.components[0]).toMatchObject({ checked: { '@path': '/checked' } });
    expect(normalized.components[1]).toMatchObject({ action: { event: { context: { x: { '@path': '/x' } } } } });
    expect(normalizeBindingKeys({ "'path'": 1, title: 'Courses' })).toEqual({ "'path'": 1, title: 'Courses' });
  });
});
