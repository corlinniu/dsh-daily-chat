/**
 * Host half of the daily-chat plugin.
 *
 * Three jobs, all of which the browser cannot do reliably:
 *
 * 1. Make the `daily` agent preset real. A preset is a directory under the
 *    harness home's user preset root (`<dshHome>/.agent-presets/<id>/`), and
 *    nothing a plugin can declare contributes one — the roster merges only the
 *    presets shipped with the harness, the roots a deployment configured, and
 *    that user root. So this package carries its own copy under `preset/daily/`
 *    and installs it here, which is what makes a fresh install work without a
 *    manual copying step.
 *
 *    Installed, never enforced: a preset already sitting at the target path is
 *    left exactly as it is, so an operator who edited theirs keeps their edits
 *    and this row never fights them on the next reload.
 *
 * 2. Make the `daily-chat` workspace real before anything tries to adopt it.
 *    The client half identifies that workspace by its directory basename, so as
 *    long as this half guarantees `<harness home>/daily-chat` exists and is
 *    registered, the browser never has to guess a path or ask the operator to
 *    pick one.
 *
 * 3. Keep a daily chat on its own preset. A session that lives in the daily
 *    workspace may not be recomposed on another preset, and only the Host can
 *    promise that: the client half hides the new-chat row's 「Agent 模式」 chip
 *    and the client-side navigation refusals cover the project chip, but a
 *    preset switch is also reachable from surfaces this plugin does not own —
 *    the settings section's "make default" writes the new default through to
 *    the current blank session — and the preset decides which tools the model
 *    holds at all.
 *
 * The harness home is read from `DSH_HOME` with the same default the rest of the
 * deployment uses. The first two jobs are best-effort: a failure costs a warning
 * and nothing else, because the client half already handles a missing preset (it
 * falls back to the deployment default) and a missing workspace (it falls back
 * to the directory picker). The third job is silent when the services it needs
 * are absent, and simply does not lock anything.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The durable workspace registry this row registers the daily directory in. */
export const inject = ['workspaceRegistry'];

/** The directory name the client half matches a workspace by. */
export const DAILY_DIRECTORY = 'daily-chat';

/** The preset id the client half asks a daily session to run on. */
export const DAILY_PRESET = 'daily';

/** The composition file that makes a preset directory a preset at all. */
const PRESET_COMPOSITION = 'agent.cordis.yml';

/**
 * What a blocked preset switch says. The client half already reads this field
 * class back out as the reason under DSH's own 「无法切换」 toast, so the wording
 * is the operator-facing message, not a log line.
 */
const LOCKED_PRESET_REASON =
  `日常聊天固定使用 ${DAILY_PRESET} 预设；要获得完整能力，请点侧边栏的「开始工作」。`;

/**
 * The preset copy this package ships. Resolved relative to this module rather
 * than the process working directory, so the path holds wherever the package
 * ends up: a linked checkout, a pnpm store, an unpacked tarball.
 */
const PRESET_SOURCE = fileURLToPath(new URL(`./preset/${DAILY_PRESET}/`, import.meta.url));

/** The harness home `DSH_HOME` names, or the deployment's own default. */
function harnessHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
}

/**
 * Install this package's `daily` preset into the user preset root, unless one
 * is already there.
 * @param ctx - the Host context this row was mounted with.
 * @param home - the harness home.
 */
function installDailyPreset(ctx, home) {
  const target = join(home, '.agent-presets', DAILY_PRESET);

  try {
    // Presence of the composition file is what makes the directory a preset:
    // an operator's own `daily` wins, an empty or half-written one is completed.
    if (existsSync(join(target, PRESET_COMPOSITION))) return;
    mkdirSync(dirname(target), { recursive: true });
    cpSync(PRESET_SOURCE, target, { recursive: true });
    ctx.logger?.info?.(`[daily-chat] installed the "${DAILY_PRESET}" preset at ${target}`);
  } catch (reason) {
    ctx.logger?.warn?.(
      `[daily-chat] installing the "${DAILY_PRESET}" preset at ${target} failed: ${String(reason)}`,
    );
  }
}

/**
 * Create the daily-chat directory and register it as a workspace.
 * @param ctx - the Host context this row was mounted with.
 * @param home - the harness home.
 */
async function registerDailyWorkspace(ctx, home) {
  const directory = join(home, DAILY_DIRECTORY);

  try {
    mkdirSync(directory, { recursive: true });
  } catch (reason) {
    ctx.logger?.warn?.(`[daily-chat] creating ${directory} failed: ${String(reason)}`);
    return;
  }

  try {
    if ((await ctx.workspaceRegistry.resolveByPath(directory)) !== undefined) return;
    const workspace = await ctx.workspaceRegistry.create(directory, '日常聊天');
    ctx.logger?.info?.(`[daily-chat] daily workspace ready at ${workspace.path}`);
  } catch (reason) {
    ctx.logger?.warn?.(`[daily-chat] registering ${directory} as a workspace failed: ${String(reason)}`);
  }
}

/**
 * The project directory a session was created in, when the Host knows it.
 * @param agent - the agent handle the gateway resolved for a preset switch.
 * @returns the absolute `cwd`, or undefined for anything unexpected.
 */
function sessionDirectory(agent) {
  try {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === 'string' ? cwd : undefined;
  } catch (reason) {
    return undefined;
  }
}

/**
 * Refuse to move a daily session onto another agent preset.
 *
 * The patch sits on the service PROTOTYPE, where the shipped method is: the
 * gateway resolves a fresh traceable proxy of the one `agentPresets` instance
 * per invocation and reads the method off the prototype at call time, so one
 * patch covers every caller — the new-chat chip, the settings section, and any
 * surface added later. The disposer puts the original back when this row
 * unloads.
 *
 * The rule is scoped to the daily workspace rather than to the preset id: the
 * `daily` preset is a normal, pickable row in the roster, and an operator who
 * deliberately runs a work session on it must still be able to switch back.
 * A session the Daily half put in `<harness home>/daily-chat` has no such
 * business.
 *
 * @param ctx - the Host context this row was mounted with.
 * @param home - the harness home.
 */
function lockDailyPreset(ctx, home) {
  const workspaceDirectory = join(home, DAILY_DIRECTORY);

  ctx.inject(['agentPresets'], (presetCtx) => {
    presetCtx.effect(() => {
      const proto = Object.getPrototypeOf(presetCtx.agentPresets);
      const original = proto === null ? undefined : proto.select;
      if (typeof original !== 'function') return undefined;

      proto.select = function select(agent, agentPreset) {
        if (agentPreset !== DAILY_PRESET && sessionDirectory(agent) === workspaceDirectory) {
          throw new Error(LOCKED_PRESET_REASON);
        }
        return original.call(this, agent, agentPreset);
      };

      return () => {
        proto.select = original;
      };
    }, 'daily-chat: daily preset lock');
  });
}

/**
 * Prepare everything a daily chat needs before the client half asks for it.
 * @param ctx - the Host context this row was mounted with.
 */
export async function apply(ctx) {
  const home = harnessHome();
  installDailyPreset(ctx, home);
  lockDailyPreset(ctx, home);
  await registerDailyWorkspace(ctx, home);
}
