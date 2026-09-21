/**
 * Host half of the daily-chat plugin.
 *
 * Exactly one job, and it is one the browser cannot do reliably: make the
 * `daily-chat` workspace real before anything tries to adopt it. The client half
 * identifies that workspace by its directory basename, so as long as this half
 * guarantees `<harness home>/daily-chat` exists and is registered, the browser
 * never has to guess a path or ask the operator to pick one.
 *
 * The harness home is read from `DSH_HOME` with the same default the rest of the
 * deployment uses. Registering the directory is idempotent: an already
 * registered path is left alone, and a directory that cannot be created only
 * costs a warning — the client half still falls back to the directory picker.
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The durable workspace registry this row registers the daily directory in. */
export const inject = ['workspaceRegistry'];

/** The directory name the client half matches a workspace by. */
export const DAILY_DIRECTORY = 'daily-chat';

/**
 * Create the daily-chat directory and register it as a workspace.
 * @param ctx - the Host context this row was mounted with.
 */
export async function apply(ctx) {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
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
