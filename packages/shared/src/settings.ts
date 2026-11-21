/** The roles of the language models: `fast`, everyday answers; `reasoning`, answers that need thinking; `background`, hidden calls (pre-analysis, memory, titles). */
export type ChatRole = 'fast' | 'reasoning' | 'background';
/** Every model the admin picks: the language models, and `image`, which draws the images the user asks for. */
export type ModelRole = ChatRole | 'image';

export const MODEL_ROLES: readonly ModelRole[] = ['fast', 'reasoning', 'background', 'image'];

/** The admin page edits these prompts; each has a default in the server's code. */
export type PromptName = 'assistant' | 'preAnalysis' | 'memory';

export const PROMPT_NAMES: readonly PromptName[] = ['assistant', 'preAnalysis', 'memory'];

export const MAX_PROMPT_LENGTH = 20_000;

/**
 * What OpenRouter says a model can do, among what the app needs. `thinking_off`: its thinking can be turned off
 * (OpenRouter's `reasoning.mandatory` is not set). `image_output`: it draws images. `audio`, `video`, `file`: it reads
 * them (OpenRouter's `input_modalities`; `file` is a PDF read natively).
 */
export type ModelCapability =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'tools'
  | 'reasoning'
  | 'thinking_off'
  | 'structured_outputs'
  | 'image_output';

/**
 * Answers read text, photos and documents and use the web search and the canvas; the reasoning role thinks first;
 * the background calls answer in a JSON schema with thinking off, since they run before every answer. A fast model
 * whose thinking cannot be turned off thinks as little as it can. Images are drawn from words and from the user's
 * photos.
 */
const REQUIREMENTS: Record<ModelRole, readonly ModelCapability[]> = {
  fast: ['text', 'image', 'tools'],
  reasoning: ['text', 'image', 'tools', 'reasoning'],
  background: ['text', 'structured_outputs', 'thinking_off'],
  image: ['text', 'image', 'image_output'],
};

/** Empty when the model can take the role. */
export function missingCapabilities(role: ModelRole, capabilities: readonly ModelCapability[]): ModelCapability[] {
  return REQUIREMENTS[role].filter((capability) => !capabilities.includes(capability));
}
