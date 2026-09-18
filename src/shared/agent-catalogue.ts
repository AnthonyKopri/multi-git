// The coding agents Multi-Git knows how to seed a definition from, and the
// models each one can be pointed at.
//
// This is a convenience table, not a policy. Nothing here decides what may be
// launched — a saved definition does, and every entry below becomes one the
// user can edit or delete. The value of the table is that it saves reading a
// tool's `--help` to find out that Gemini's interactive prompt flag is `-i`
// while Claude Code takes the prompt as a bare argument.
//
// Two rules keep it honest:
//
//   * A prompt mode is only claimed where the flag starts an *interactive*
//     session carrying that prompt. Several of these tools have a one-shot
//     mode (`gemini -p`, `aider --message`, `copilot -p`) that prints an answer
//     and exits; handing an interactive launch to one of those would close the
//     window before it could be read, so those entries take no prompt.
//
//   * A model preset is only listed where its flag is the tool's own
//     documented one. Model names age faster than this file will be edited,
//     so every preset is a starting point that lands in an editable definition
//     rather than something the launcher insists on.
//
// The base-URL presets are the other half of "which model". Claude Code speaks
// to any Anthropic-compatible endpoint, and Moonshot, DeepSeek and Z.ai all
// publish one — so Kimi, DeepSeek and GLM are reachable through the same tool
// rather than needing a CLI of their own. Their keys are never stored here:
// the preset names the variable, and the launcher passes it through from the
// environment the user already set it in.

/** How a starting prompt reaches a tool. */
export type AgentPromptMode = 'none' | 'argument' | 'flag';

/** One way to point a tool at a particular model or provider. */
export interface AgentModelPreset {
  id: string;
  label: string;
  /** Who serves the model, for the grouping the picker shows. */
  vendor: string;
  /** Appended after the definition's own arguments. */
  args?: string[];
  /** Extra environment for the launch. Never a credential. */
  env?: Record<string, string>;
  /**
   * Variables the user must already have in their environment.
   *
   * Named rather than collected: an API key typed into Multi-Git would end up
   * in a plain JSON file in the home directory, and there is no version of
   * that which is better than reading the one the shell already exports.
   */
  requiresEnv?: string[];
  note?: string;
}

export interface AgentCatalogueEntry {
  id: string;
  label: string;
  vendor: string;
  /** Executable looked for on PATH. */
  executable: string;
  /** One line describing what the tool is, shown wherever it is offered. */
  summary: string;
  /** Where to read about it or install it. */
  homepage: string;
  /** Arguments a seeded definition starts with. */
  args?: string[];
  promptMode: AgentPromptMode;
  /** For `flag` mode: what goes in front of the prompt. */
  promptArgs?: string[];
  models?: AgentModelPreset[];
}

/**
 * Anthropic-compatible endpoints, which is how one tool reaches many models.
 *
 * Each is the provider's own published address for its Anthropic-shaped API.
 * `ANTHROPIC_AUTH_TOKEN` rather than `ANTHROPIC_API_KEY`, because the key
 * belongs to that provider and not to Anthropic.
 */
function anthropicCompatible(
  id: string,
  label: string,
  vendor: string,
  baseUrl: string,
  model: string,
  note: string
): AgentModelPreset {
  return {
    id,
    label,
    vendor,
    env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_MODEL: model },
    requiresEnv: ['ANTHROPIC_AUTH_TOKEN'],
    note
  };
}

/** Every tool this build can seed a definition from, in the order it offers them. */
export const AGENT_CATALOGUE: readonly AgentCatalogueEntry[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    vendor: 'Anthropic',
    executable: 'claude',
    summary: 'Anthropic’s terminal agent. Takes the prompt as its first argument.',
    homepage: 'https://claude.com/claude-code',
    promptMode: 'argument',
    models: [
      { id: 'default', label: 'Whatever you are signed in to', vendor: 'Anthropic' },
      { id: 'opus', label: 'Claude Opus', vendor: 'Anthropic', args: ['--model', 'opus'] },
      { id: 'sonnet', label: 'Claude Sonnet', vendor: 'Anthropic', args: ['--model', 'sonnet'] },
      { id: 'haiku', label: 'Claude Haiku', vendor: 'Anthropic', args: ['--model', 'haiku'] },
      anthropicCompatible(
        'kimi-k2',
        'Kimi K2',
        'Moonshot AI',
        'https://api.moonshot.ai/anthropic',
        'kimi-k2-turbo-preview',
        'Moonshot’s Anthropic-compatible endpoint. Needs a Moonshot key.'
      ),
      anthropicCompatible(
        'deepseek',
        'DeepSeek',
        'DeepSeek',
        'https://api.deepseek.com/anthropic',
        'deepseek-chat',
        'DeepSeek’s Anthropic-compatible endpoint. Needs a DeepSeek key.'
      ),
      anthropicCompatible(
        'glm',
        'GLM',
        'Z.ai',
        'https://api.z.ai/api/anthropic',
        'glm-4.6',
        'Z.ai’s Anthropic-compatible endpoint. Needs a Z.ai key.'
      )
    ]
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    executable: 'codex',
    summary: 'OpenAI’s terminal agent. Takes the prompt as its first argument.',
    homepage: 'https://developers.openai.com/codex/cli',
    promptMode: 'argument',
    models: [
      { id: 'default', label: 'Whatever you are signed in to', vendor: 'OpenAI' },
      { id: 'gpt-5-codex', label: 'GPT-5 Codex', vendor: 'OpenAI', args: ['-m', 'gpt-5-codex'] },
      { id: 'gpt-5', label: 'GPT-5', vendor: 'OpenAI', args: ['-m', 'gpt-5'] }
    ]
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Google',
    executable: 'gemini',
    summary: 'Google’s terminal agent. Opens interactively on a prompt with -i.',
    homepage: 'https://github.com/google-gemini/gemini-cli',
    // `-p` is the other prompt flag, and the wrong one here: it answers once
    // and exits, which for a launched window means it closes immediately.
    promptMode: 'flag',
    promptArgs: ['-i'],
    models: [
      { id: 'default', label: 'Whatever the CLI defaults to', vendor: 'Google' },
      { id: 'pro', label: 'Gemini 2.5 Pro', vendor: 'Google', args: ['-m', 'gemini-2.5-pro'] },
      { id: 'flash', label: 'Gemini 2.5 Flash', vendor: 'Google', args: ['-m', 'gemini-2.5-flash'] }
    ]
  },
  {
    id: 'qwen',
    label: 'Qwen Code',
    vendor: 'Alibaba',
    executable: 'qwen',
    summary: 'Qwen’s terminal agent, built on the Gemini CLI, so -i works the same way.',
    homepage: 'https://github.com/QwenLM/qwen-code',
    promptMode: 'flag',
    promptArgs: ['-i'],
    models: [
      { id: 'default', label: 'Whatever the CLI defaults to', vendor: 'Alibaba' },
      { id: 'coder-plus', label: 'Qwen3 Coder Plus', vendor: 'Alibaba', args: ['-m', 'qwen3-coder-plus'] },
      { id: 'coder-flash', label: 'Qwen3 Coder Flash', vendor: 'Alibaba', args: ['-m', 'qwen3-coder-flash'] }
    ]
  },
  {
    id: 'cursor-agent',
    label: 'Cursor CLI',
    vendor: 'Cursor',
    executable: 'cursor-agent',
    summary: 'Cursor’s agent outside the editor. Takes the prompt as its first argument.',
    homepage: 'https://cursor.com/cli',
    promptMode: 'argument'
  },
  {
    id: 'aider',
    label: 'Aider',
    vendor: 'Aider',
    executable: 'aider',
    summary: 'Pair programming in the terminal, with its own model shortcuts.',
    homepage: 'https://aider.chat',
    // `--message` is a one-shot: it answers and exits, so it is not offered as
    // an interactive starting prompt.
    promptMode: 'none',
    models: [
      { id: 'default', label: 'Whatever aider is configured for', vendor: 'Aider' },
      { id: 'sonnet', label: 'Claude Sonnet', vendor: 'Anthropic', args: ['--sonnet'] },
      { id: 'opus', label: 'Claude Opus', vendor: 'Anthropic', args: ['--opus'] },
      { id: 'deepseek', label: 'DeepSeek', vendor: 'DeepSeek', args: ['--deepseek'] },
      { id: 'gemini', label: 'Gemini', vendor: 'Google', args: ['--gemini'] }
    ]
  },
  {
    id: 'kimi',
    label: 'Kimi CLI',
    vendor: 'Moonshot AI',
    executable: 'kimi',
    summary: 'Moonshot’s own terminal agent for the Kimi models.',
    homepage: 'https://github.com/MoonshotAI/kimi-cli',
    promptMode: 'none'
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    vendor: 'SST',
    executable: 'opencode',
    summary: 'A provider-agnostic terminal agent; the model is chosen inside it.',
    homepage: 'https://opencode.ai',
    promptMode: 'none'
  },
  {
    id: 'crush',
    label: 'Crush',
    vendor: 'Charm',
    executable: 'crush',
    summary: 'Charm’s terminal agent, configured from its own file.',
    homepage: 'https://github.com/charmbracelet/crush',
    promptMode: 'none'
  },
  {
    id: 'goose',
    label: 'Goose',
    vendor: 'Block',
    executable: 'goose',
    summary: 'Block’s extensible agent, with its own provider configuration.',
    homepage: 'https://block.github.io/goose',
    promptMode: 'none'
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    vendor: 'GitHub',
    executable: 'copilot',
    summary: 'Copilot in the terminal, signed in through GitHub.',
    homepage: 'https://github.com/features/copilot/cli',
    promptMode: 'none'
  },
  {
    id: 'amp',
    label: 'Amp',
    vendor: 'Sourcegraph',
    executable: 'amp',
    summary: 'Sourcegraph’s agent, with its own model selection.',
    homepage: 'https://ampcode.com',
    promptMode: 'none'
  },
  {
    id: 'droid',
    label: 'Droid',
    vendor: 'Factory',
    executable: 'droid',
    summary: 'Factory’s terminal agent.',
    homepage: 'https://factory.ai',
    promptMode: 'none'
  },
  {
    id: 'continue',
    label: 'Continue CLI',
    vendor: 'Continue',
    executable: 'cn',
    summary: 'Continue’s terminal agent, driven by its own assistant configuration.',
    homepage: 'https://continue.dev',
    promptMode: 'none'
  }
];

export function findCatalogueEntry(catalogueId: string | undefined): AgentCatalogueEntry | null {
  if (!catalogueId) {
    return null;
  }
  return AGENT_CATALOGUE.find((entry) => entry.id === catalogueId) ?? null;
}

/** The models a catalogue entry offers, or none when it has no presets. */
export function modelPresetsFor(catalogueId: string | undefined): readonly AgentModelPreset[] {
  return findCatalogueEntry(catalogueId)?.models ?? [];
}

export function findModelPreset(
  catalogueId: string | undefined,
  modelId: string | undefined
): AgentModelPreset | null {
  if (!modelId) {
    return null;
  }
  return modelPresetsFor(catalogueId).find((preset) => preset.id === modelId) ?? null;
}
