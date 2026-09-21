/**
 * Client half of the daily-chat plugin.
 *
 * The product idea: DSH's New Session has one meaning — the full coding agent.
 * This plugin splits it into two, the way ChatGPT splits chat from work:
 *
 *   日常  a lightweight conversation agent. Its own agent preset (`daily`) is
 *         composed of a chat persona, the web tools, the question tool and
 *         compaction — no files, no shell, no plan mode, no subagents. The loop
 *         is 用户消息 → 模型 → 工具调用 → 回复.
 *   工作  exactly the shipped behaviour, untouched.
 *
 * Four contributions hold that up:
 *
 * 1. Two labeled mode rows. The shipped New Session button is hand-written JSX
 *    inside the sidebar shell and is wrapped by no slot, so nothing can be added
 *    beside it; the sidebar's own additive seats are the only places a plugin
 *    may appear. The one that renders a full-width icon + label row is
 *    `sidebar.panellist`, so 「日常聊天」 and 「开始工作」 live there, ordered
 *    above 「插件」 by a negative `order` (the shell sorts by it ascending, and
 *    panels default to 0). A panellist row's click is the shell's and is fixed
 *    to `selectPanel(id)`, which is why contribution 2 exists.
 * 2. Two `main` panels under those ids, one per row. Both are transient: a row
 *    ACTS rather than navigates, so the panel performs the action and hands the
 *    centre column straight back to the conversation. That is what makes both
 *    rows land in the composer, with no page in between.
 * 3. The daily session list in `sidebar.workspaces`. Work mode leaves that slot
 *    completely alone: our entry is registered with `priority: -1`, and for a
 *    `single` slot the LOWEST live priority renders, so ours wins while it is
 *    registered and the shipped browser returns the moment it is disposed.
 * 4. A prototype patch of `uiWorkspace.startSession` — the one method every New
 *    Session entry point calls, the sidebar shell's own button included — so
 *    that button starts a daily chat instead of a work session while 日常 is
 *    the active mode.
 *
 * Daily chats are Sessions in a dedicated workspace, so "daily" is a durable
 * place rather than a UI flag: the history survives, and the lists are just the
 * sessions accounted to that workspace.
 *
 * The mode is remembered in `localStorage`, the same mechanism the shipped
 * client plugins use for their own UI preferences.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-daily-chat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    /** Locale namespace for this plugin's own copy. */
    const LOCALE_NS = 'dailyChat';
    /** The single localStorage key holding the active mode. */
    const MODE_KEY = 'dsh.daily-chat.mode';
    /** The `<html>` attribute the mode-scoped chrome rules hang off. */
    const MODE_ATTRIBUTE = 'data-dsc-mode';
    /** The agent preset a daily chat runs on. */
    const DAILY_PRESET = 'daily';
    /** The workspace directory basename that identifies the daily workspace. */
    const DAILY_DIRECTORY = 'daily-chat';
    /** The `main` panel the 「日常聊天」 sidebar row opens. */
    const DAILY_PANEL = 'daily-chat';
    /** The `main` panel the 「开始工作」 sidebar row transiently opens. */
    const WORK_PANEL = 'daily-chat-work';

    const zh = {
      dismiss: '知道了',
      dailyChats: '日常聊天',
      startWork: '开始工作',
      newChat: '＋ 日常聊天',
      lockedProject: '日常聊天固定在自己的工作区，不能切换项目。要开始工作，请点侧边栏的「开始工作」。',
      starting: '正在打开日常聊天…',
      startingWork: '正在切换到工作模式…',
      empty: '还没有日常聊天，点上面开始第一句。',
      needWorkspace: '没能准备好日常聊天目录，请在弹出的选择框里挑一个文件夹。',
      failed: '打开日常聊天失败',
      justNow: '刚刚',
      unitMinutes: '分钟',
      unitHours: '小时',
      unitDays: '天',
      unitMonths: '个月',
      unitYears: '年',
    };

    const en = {
      dismiss: 'Dismiss',
      dailyChats: 'Chats',
      startWork: 'Start working',
      newChat: '+ Chat',
      lockedProject: 'A chat stays in its own workspace — use “Start working” in the sidebar to open a project.',
      starting: 'Opening chat…',
      startingWork: 'Switching to work…',
      empty: 'No chats yet. Start one above.',
      needWorkspace: 'Could not prepare the chat folder — pick one in the dialog.',
      failed: 'Could not open the chat',
      justNow: 'now',
      unitMinutes: 'm',
      unitHours: 'h',
      unitDays: 'd',
      unitMonths: 'mo',
      unitYears: 'y',
    };

    const CSS = [
      // The mode rows are `sidebar.panellist` entries, which the shell renders
      // as icon + label (the shape of 「插件」). What is left here for the centre
      // column is the one-frame placeholder a transient mode panel paints.
      '.dsc-panel{display:flex;flex-direction:column;min-height:0;height:100%;padding:28px 24px 24px;overflow-y:auto}',
      '.dsc-panelInner{display:flex;flex-direction:column;gap:14px;width:100%;max-width:720px;margin:0 auto}',
      '.dsc-panelHint{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',

      // The overlay layer itself is click-through, so an occupant opts back in.
      '.dsc-toast{position:fixed;bottom:18px;left:18px;z-index:60;pointer-events:auto;display:flex;align-items:flex-start;gap:10px;max-width:360px;padding:10px 12px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18)}',
      '.dsc-toast-text{min-width:0;word-break:break-word}',
      '.dsc-toast-close{flex:none;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:0}',
      '.dsc-toast-close:hover{color:var(--dsw-alias-label-primary)}',

      '.dsc-region{display:flex;flex-direction:column;min-height:0;height:100%;padding:2px 0 0}',
      '.dsc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px 8px}',
      '.dsc-title{font-size:11px;line-height:16px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}',
      '.dsc-new{height:26px;padding:0 9px;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;white-space:nowrap}',
      '.dsc-new:hover{border-color:var(--dsw-alias-border-l2)}',
      '.dsc-list{display:flex;flex-direction:column;gap:1px;flex:1;min-height:0;overflow-y:auto;padding-bottom:6px}',
      '.dsc-row{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;font:inherit;text-align:left;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:0;border-radius:8px}',
      '.dsc-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsc-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2)}',
      '.dsc-dot-on{background:var(--dsw-alias-state-success-primary)}',
      '.dsc-rowtext{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}',
      '.dsc-rowtitle{overflow:hidden;font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}',
      '.dsc-rowtime{font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary)}',
      '.dsc-empty{padding:10px 8px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
    ].join('');

    /**
     * Chrome adjustments that no additive seat can express.
     *
     * The sidebar shell's own New Session button is hand-written JSX inside a
     * shipped plugin and is wrapped by no slot, so it cannot be unregistered,
     * configured away or replaced from the outside — hiding it is the only lever
     * an additive plugin has. Three facts make this selector safe rather than a
     * blind guess:
     *
     * - `newSession` is the CSS-module LOCAL name of exactly that one button in
     *   `@deepseek-ai/dsh-client-ui-sidebar`, and that package is the only place
     *   in this deployment that defines it (verified across every installed
     *   bundle);
     * - the macOS window-chrome control that does the same job lives in a
     *   different module and uses a different class, so it is NOT caught here —
     *   it stays available when the sidebar is hidden;
     * - if a future version renames the class the rule simply stops matching and
     *   the button comes back. The failure mode is "visible again", never
     *   "something else disappeared".
     *
     * (The one place this over-hides is a Windows titlebar rail, where the shell
     * hides the panel list and this button would be the remaining affordance.
     * This profile runs macOS.)
     *
     * The second rule is mode-scoped: it hangs off an attribute this plugin puts
     * on `<html>` while 日常 is the active mode, and the attribute goes away with
     * the mode, so the rule only exists for a daily chat. It hides the new-chat
     * row the conversation renders above the composer — 「项目」 and 「Agent 模式」,
     * the two choices a daily chat does not get to make, because its workspace
     * and its preset are what make it a daily chat. Typing into either is refused
     * on the service side as well (the `openWorkspace` patch below, and the
     * Host's preset lock), so this rule is what the operator sees rather than
     * the only thing standing in the way. As with the button rule, a renamed
     * class means the row simply comes back.
     */
    const CHROME_CSS = [
      'button[class*="newSession"]{display:none !important}',
      `html[${MODE_ATTRIBUTE}="daily"] [class*="heroWorkspaceRow"]{display:none !important}`,
    ].join('');

    /* ── relative time ────────────────────────────────────────────────────── */

    const bucketOf = typeof primitives.relativeTime === 'function'
      ? primitives.relativeTime
      : fallbackBucket;

    /** Local bucketing used only when the primitives module has no helper. */
    function fallbackBucket(at, now) {
      const minutes = Math.floor(Math.max(0, now - at) / 60000);
      if (minutes < 1) return { unit: 'now', n: 0 };
      if (minutes < 60) return { unit: 'minutes', n: minutes };
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return { unit: 'hours', n: hours };
      const days = Math.floor(hours / 24);
      if (days < 30) return { unit: 'days', n: days };
      const months = Math.floor(days / 30);
      if (months < 12) return { unit: 'months', n: months };
      return { unit: 'years', n: Math.floor(months / 12) };
    }

    /** The dictionary word for one bucket; the magnitude stays numeric. */
    const UNIT_KEYS = {
      minutes: 'unitMinutes',
      hours: 'unitHours',
      days: 'unitDays',
      months: 'unitMonths',
      years: 'unitYears',
    };

    /**
     * Localize one dated row.
     * @param at - epoch ms.
     * @param now - current epoch ms.
     * @param t - this plugin's bound translator.
     * @returns the trailing label.
     */
    function timeLabel(at, now, t) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return '';
      const bucket = bucketOf(at, now);
      if (bucket.unit === 'now') return t('justNow');
      const key = UNIT_KEYS[bucket.unit];
      return key === undefined ? '' : bucket.n + t(key);
    }

    /* ── mode store ───────────────────────────────────────────────────────── */

    /** Read the persisted mode; anything unreadable means work. */
    function readMode() {
      try {
        if (typeof localStorage === 'undefined') return 'work';
        return localStorage.getItem(MODE_KEY) === 'daily' ? 'daily' : 'work';
      } catch (reason) {
        console.warn('[daily-chat] reading the saved mode failed:', reason);
        return 'work';
      }
    }

    let state = { mode: readMode(), busy: false, error: null };
    const listeners = new Set();

    /**
     * Reflect the active mode onto the document, which is what the mode-scoped
     * chrome rules key off. The CSS this plugin injects is static, so the mode
     * has to be readable from the DOM rather than from React state; anything
     * other than `daily` means the attribute is absent and every rule that
     * depends on it is inert.
     * @param mode - the mode to publish.
     */
    function syncModeAttribute(mode) {
      try {
        if (typeof document === 'undefined') return;
        if (mode === 'daily') document.documentElement.setAttribute(MODE_ATTRIBUTE, 'daily');
        else document.documentElement.removeAttribute(MODE_ATTRIBUTE);
      } catch (reason) {
        console.warn('[daily-chat] publishing the active mode to the document failed:', reason);
      }
    }

    /** Merge one state patch, persist the mode, and notify every reader. */
    function setState(patch) {
      state = Object.assign({}, state, patch);
      if (patch.mode !== undefined) {
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(MODE_KEY, patch.mode);
        } catch (reason) {
          console.warn('[daily-chat] saving the mode failed:', reason);
        }
        syncModeAttribute(patch.mode);
      }
      for (const listener of [...listeners]) listener();
    }

    /** Subscribe one reader to the mode state. */
    function subscribeState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    /** Read the current state; identity-stable between mutations. */
    function readState() {
      return state;
    }

    /** The component-side reader. */
    function useChatState() {
      return React.useSyncExternalStore(subscribeState, readState, readState);
    }

    /* ── fallback snapshots ───────────────────────────────────────────────── */

    // The standard-prop hooks come from plugins this one does not own. Using a
    // stable empty snapshot instead of guessing keeps the hook order fixed and
    // degrades to an empty list rather than a crash when a source is absent.
    const EMPTY_WORKSPACES = {
      items: [], archivedSessionIds: [], state: 'idle', phase: 'pending', error: null,
    };
    const EMPTY_SESSIONS = {
      ids: [], byId: {}, phase: 'pending', subagentsByParent: {}, jobsBySession: {},
    };

    /** A short human-readable reason for a failed start. */
    function describe(reason) {
      if (reason === null || reason === undefined) return 'unknown error';
      if (typeof reason === 'string') return reason;
      if (typeof reason.message === 'string' && reason.message !== '') return reason.message;
      if (typeof reason.code === 'string') return reason.code;
      try {
        return JSON.stringify(reason);
      } catch (ignored) {
        return String(reason);
      }
    }

    /* ── artwork ──────────────────────────────────────────────────────────── */

    /**
     * A chat bubble. The seat decides the size: the sidebar asks a
     * `sidebar.panellist` occupant for 16px wide and 18px in the rail.
     */
    function ChatGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', {
        d: 'M4.5 6.4A2.4 2.4 0 0 1 6.9 4h10.2a2.4 2.4 0 0 1 2.4 2.4v6a2.4 2.4 0 0 1-2.4 2.4h-5.2L7.6 18.6v-3.8H6.9a2.4 2.4 0 0 1-2.4-2.4z',
      }));
    }

    /** A terminal window, same seat contract as {@link ChatGlyph}. */
    function WorkGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 16;
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, [
        h('rect', { key: 'frame', x: 3.4, y: 4.4, width: 17.2, height: 15.2, rx: 2.4 }),
        h('path', { key: 'caret', d: 'M7.6 10.2l2.3 2.1-2.3 2.1' }),
        h('path', { key: 'line', d: 'M12.6 14.6h4' }),
      ]);
    }

    return {
      inject: [
        'slots',
        'locale',
        'layout',
        'remote',
        'remote.agentPresets',
        'uiWorkspace',
        'workspaces',
      ],

      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, { zh, en }),
          'daily-chat: dictionaries',
        );
        const t = ctx.locale.bind(LOCALE_NS);

        // Publish the mode the page loaded with, and take the mark away when
        // this plugin unloads: the chrome rules it drives belong to the plugin,
        // so nothing of them may outlive it.
        ctx.effect(() => {
          syncModeAttribute(state.mode);
          return () => syncModeAttribute('work');
        }, 'daily-chat: mode-scoped chrome');

        /** The shipped `startSession`, restored on unload. */
        let originalStartSession = undefined;
        /** Re-entrancy guard: starting a chat must not re-enter through the patch. */
        let starting = false;
        /** Bumped by every mode action so a slow start cannot land after a newer one. */
        let startTicket = 0;

        /** The harness home as the Host reports it, when it does. */
        function hostHome() {
          try {
            const facts = ctx.remote.$host;
            if (facts !== undefined && typeof facts.home === 'string' && facts.home !== '') {
              return facts.home.replace(/\/+$/, '');
            }
          } catch (reason) {
            console.warn('[daily-chat] reading host facts failed:', reason);
          }
          return undefined;
        }

        /** Find the daily workspace among the registered ones. */
        function pickDailyWorkspace(items) {
          const home = hostHome();
          if (home !== undefined) {
            const expected = home + '/.dsh/' + DAILY_DIRECTORY;
            for (const item of items) {
              if (item.path === expected) return item;
            }
          }
          for (const item of items) {
            const segments = item.path.split(/[\\/]/);
            if (segments[segments.length - 1] === DAILY_DIRECTORY) return item;
          }
          return undefined;
        }

        /**
         * Whether opening one workspace would stay inside the daily workspace.
         *
         * Project switching is the one navigation a daily chat does not get: its
         * workspace is what makes it a daily chat, and every other workspace
         * belongs to the work half of the product. The daily workspace is
         * resolved on each call rather than remembered, so this holds on a page
         * that is still waiting for the Host's first workspace baseline — an
         * unresolved daily workspace lets the navigation through rather than
         * breaking it outright.
         * @param workspaceId - the workspace the navigation targets.
         * @returns whether the target is the daily workspace.
         */
        function staysDaily(workspaceId) {
          const daily = pickDailyWorkspace(ctx.workspaces.list.getSnapshot().items);
          return daily !== undefined && workspaceId === daily.workspaceId;
        }

        /** Resolve once the Host's first workspace baseline lands, or on timeout. */
        function waitForWorkspaceBaseline(timeoutMs) {
          const source = ctx.workspaces.list;
          if (source.getSnapshot().phase === 'ready') return Promise.resolve();
          return new Promise((resolve) => {
            let settled = false;
            let timer = null;
            function finish() {
              if (settled) return;
              settled = true;
              off();
              if (timer !== null) clearTimeout(timer);
              resolve();
            }
            const off = source.subscribe(() => {
              if (source.getSnapshot().phase === 'ready') finish();
            });
            timer = setTimeout(finish, timeoutMs);
          });
        }

        /** Adopt one directory as the daily workspace, creating it when missing. */
        async function adopt(path) {
          try {
            return await ctx.workspaces.create({ path });
          } catch (reason) {
            const cut = path.lastIndexOf('/');
            if (cut <= 0) return undefined;
            try {
              await ctx.uiWorkspace.createDirectory(path.slice(0, cut), path.slice(cut + 1));
              return await ctx.workspaces.create({ path });
            } catch (retry) {
              console.warn(`[daily-chat] adopting ${path} failed:`, retry);
              return undefined;
            }
          }
        }

        /** The daily workspace, creating or adopting one when nothing matches. */
        async function resolveDailyWorkspace() {
          let found = pickDailyWorkspace(ctx.workspaces.list.getSnapshot().items);
          if (found !== undefined) return found;

          await waitForWorkspaceBaseline(4000);
          found = pickDailyWorkspace(ctx.workspaces.list.getSnapshot().items);
          if (found !== undefined) return found;

          const home = hostHome();
          const candidates = [];
          if (home !== undefined) {
            candidates.push(home + '/.dsh/' + DAILY_DIRECTORY);
            candidates.push(home + '/' + DAILY_DIRECTORY);
          }
          for (const candidate of candidates) {
            const adopted = await adopt(candidate);
            if (adopted !== undefined) return adopted;
          }

          const picked = await ctx.uiWorkspace.pickDirectory();
          if (typeof picked === 'string' && picked !== '') {
            return await ctx.workspaces.create({ path: picked });
          }
          throw new Error(t('needWorkspace'));
        }

        /** Open an existing session and make sure the sidebar shows chat mode. */
        function openDaily(sessionId) {
          setState({ mode: 'daily', error: null });
          ctx.layout.selectPanel(null);
          ctx.uiWorkspace.openSession(sessionId);
        }

        /**
         * Start (or reuse the blank) daily session and compose it on the daily
         * preset.
         *
         * Resolving the workspace is asynchronous, and the two mode rows are one
         * click apart: without the ticket below, picking 「开始工作」 while a
         * daily start is still in flight would let that start land afterwards
         * and drag the UI back into chat mode.
         */
        async function startDailyChat() {
          if (starting) return;
          starting = true;
          const ticket = ++startTicket;
          setState({ busy: true, error: null });
          try {
            const workspace = await resolveDailyWorkspace();
            if (ticket !== startTicket) return;
            const sessionId = await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId);
            if (ticket !== startTicket) return;
            setState({ mode: 'daily', busy: false, error: null });
            ctx.layout.selectPanel(null);
            ctx.uiWorkspace.openSession(sessionId);
            try {
              await ctx.remote.agentPresets.select(sessionId, DAILY_PRESET);
            } catch (reason) {
              console.warn(`[daily-chat] composing the "${DAILY_PRESET}" preset failed:`, reason);
            }
          } catch (reason) {
            console.warn('[daily-chat] starting a daily chat failed:', reason);
            setState({ busy: false, error: `${t('failed')}：${describe(reason)}` });
          } finally {
            starting = false;
          }
        }

        /** The shipped New Session behaviour. */
        function startWorkSession() {
          startTicket += 1;
          setState({ mode: 'work', error: null });
          ctx.layout.selectPanel(null);
          if (typeof originalStartSession === 'function') {
            originalStartSession.call(ctx.uiWorkspace);
          } else {
            ctx.uiWorkspace.startSession();
          }
        }

        /* ── the entry row, and the daily home it opens ───────────────────── */

        /**
         * Conversations accounted to the daily workspace, newest first.
         * @param workspaces - the workspace snapshot.
         * @param sessions - the session-list snapshot.
         * @returns the rows both daily surfaces render.
         */
        function dailyRows(workspaces, sessions) {
          const workspace = pickDailyWorkspace(workspaces.items);
          if (workspace === undefined || sessions.phase !== 'ready') return [];
          const archived = workspaces.archivedSessionIds;
          const rows = [];
          for (const id of workspace.sessionIds) {
            if (archived.indexOf(id) !== -1) continue;
            const row = sessions.byId[id];
            if (row === undefined || row.blank === true || row.origin === 'subagent') continue;
            rows.push(row);
          }
          rows.sort((left, right) => right.updatedAt - left.updatedAt);
          return rows;
        }

        /**
         * The standard-prop workspace reader, with a stable empty fallback so an
         * absent source degrades to an empty list instead of a crash.
         * @param props - the composed slot props.
         * @returns the workspace snapshot.
         */
        function useWorkspacesOf(props) {
          const read = typeof props.useWorkspaces === 'function'
            ? props.useWorkspaces
            : () => EMPTY_WORKSPACES;
          return read((snapshot) => snapshot);
        }

        /**
         * The standard-prop session-list reader, same fallback contract.
         * @param props - the composed slot props.
         * @returns the session-list snapshot.
         */
        function useSessionsOf(props) {
          const read = typeof props.useSessions === 'function'
            ? props.useSessions
            : () => EMPTY_SESSIONS;
          return read((snapshot) => snapshot);
        }

        /**
         * Build one transient mode panel — the surface behind a sidebar mode row.
         *
         * A `sidebar.panellist` row's click belongs to the shell and can only
         * `selectPanel(id)`, so a row that ACTS has to be a panel that hands
         * control straight back: it performs its action once and returns the
         * centre column to the conversation. Both mode rows work this way, which
         * is what makes 「日常聊天」 and 「开始工作」 land in the composer instead
         * of on an intermediate page. The line rendered below is what the centre
         * paints for the frame before the effect runs.
         *
         * @param panelId - the `main` key this panel answers for.
         * @param textKey - locale key for the placeholder line.
         * @param action - what the row does.
         * @returns the slot component.
         */
        function makeStarter(panelId, textKey, action) {
          return function Starter(props) {
            // Gated on the panel actually being the dispatched key: a keyed slot
            // may keep an entry mounted while another key renders, and mounting
            // is not selecting — acting on mount alone would fire the action just
            // for having the plugin loaded.
            const active = typeof props.usePanelInfo === 'function'
              ? props.usePanelInfo((info) => info.activePanelId === panelId)
              : true;

            React.useEffect(() => {
              if (active) action();
            }, [active]);

            return h('div', { className: 'dsc-panel' }, [
              h('style', { key: 'css' }, CSS),
              h('div', { className: 'dsc-panelInner', key: 'inner' },
                h('div', { className: 'dsc-panelHint', key: 'hint' }, props.t(textKey))),
            ]);
          };
        }

        /** 「日常聊天」: enter chat mode and land in the blank chat's composer. */
        const DailyStarter = makeStarter(DAILY_PANEL, 'starting', () => {
          void startDailyChat();
        });

        /** 「开始工作」: enter work mode and land in the work session. */
        const WorkStarter = makeStarter(WORK_PANEL, 'startingWork', () => {
          startWorkSession();
        });

        /**
         * Carries the chrome adjustments, mounted unconditionally on the
         * frame-wide overlay layer so they apply in every mode. Rendering a
         * `<style>` element means unmounting the plugin takes the rules away
         * with it.
         */
        function ChromeStyle() {
          return h('style', null, CHROME_CSS);
        }

        /**
         * A failed start has no room to print itself in a sidebar row, so it
         * surfaces as a transient card on the frame-wide overlay layer.
         */
        function ErrorToast(props) {
          const t = props.t;
          const chat = useChatState();
          if (chat.error === null) return null;

          return h('div', { className: 'dsc-toast', role: 'status' }, [
            h('style', { key: 'css' }, CSS),
            h('div', { className: 'dsc-toast-text', key: 'text' }, chat.error),
            h('button', {
              key: 'close',
              type: 'button',
              className: 'dsc-toast-close',
              onClick: () => setState({ error: null }),
            }, t('dismiss')),
          ]);
        }

        /* ── the daily browsing region ────────────────────────────────────── */

        /** The session list that stands in for the workspace browser in chat mode. */
        function DailyRegion(props) {
          const t = props.t;
          const now = Date.now();
          const workspaces = useWorkspacesOf(props);
          const sessions = useSessionsOf(props);
          const chat = useChatState();

          const rows = dailyRows(workspaces, sessions);

          return h('div', { className: 'dsc-region' }, [
            h('style', { key: 'css' }, CSS),
            h('div', { className: 'dsc-head', key: 'head' }, [
              h('div', { className: 'dsc-title', key: 'title' }, t('dailyChats')),
              h('button', {
                key: 'new',
                type: 'button',
                className: 'dsc-new',
                onClick: () => {
                  void startDailyChat();
                },
              }, t('newChat')),
            ]),
            h('div', { className: 'dsc-list', key: 'list' }, rows.length === 0
              ? h('div', { className: 'dsc-empty', key: 'empty' }, chat.busy ? t('starting') : t('empty'))
              : rows.map((row) => h('button', {
                key: row.id,
                type: 'button',
                className: 'dsc-row',
                title: row.displayTitle,
                onClick: () => openDaily(row.id),
              }, [
                h('span', {
                  key: 'dot',
                  className: 'dsc-dot' + (row.running ? ' dsc-dot-on' : ''),
                }),
                h('span', { key: 'text', className: 'dsc-rowtext' }, [
                  h('span', { key: 'title', className: 'dsc-rowtitle' }, row.displayTitle || row.id),
                  h('span', { key: 'time', className: 'dsc-rowtime' }, timeLabel(row.updatedAt, now, t)),
                ]),
              ]))),
          ]);
        }

        /* ── registration ─────────────────────────────────────────────────── */

        // The labeled entry points: two full-width rows at the TOP of the
        // sidebar's global panel list — above 「插件」, which sits at order 0 —
        // rendered by the shell as icon + label like every other panel row. The
        // shell owns the buttons and calls `selectPanel(id)`, so each panellist
        // id MUST address a registered `main` panel or that call throws; each
        // pair of registrations is therefore one unit.
        ctx.slots.inject('sidebar', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: DAILY_PANEL,
          order: -20,
          label: () => t('dailyChats'),
          locale: LOCALE_NS,
        }, ChatGlyph));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: DAILY_PANEL,
          locale: LOCALE_NS,
        }, DailyStarter));

        // The other half of the mode switch, as a sibling row: 「开始工作」.
        // Same seat, same constraint — the row needs a panel to address, and
        // that panel is the one that actually performs the switch.
        ctx.slots.inject('sidebar', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: WORK_PANEL,
          order: -10,
          label: () => t('startWork'),
          locale: LOCALE_NS,
        }, WorkGlyph));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: WORK_PANEL,
          locale: LOCALE_NS,
        }, WorkStarter));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-chrome',
          order: 1,
        }, ChromeStyle));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-error',
          order: 50,
          locale: LOCALE_NS,
        }, ErrorToast));

        // Only one entry renders a `single` slot, and it is the LOWEST live
        // priority — so `-1` takes the region over for chat mode and giving the
        // registration back puts the shipped workspace browser in charge again.
        let region = null;
        function refreshRegion() {
          if (state.mode === 'daily') {
            if (region === null) {
              region = ctx.slots.register({
                name: 'sidebar.workspaces',
                priority: -1,
                locale: LOCALE_NS,
              }, DailyRegion);
            }
            return;
          }
          if (region !== null) {
            region();
            region = null;
          }
        }

        ctx.slots.inject('sidebar.workspaces', () => {
          refreshRegion();
          listeners.add(refreshRegion);
          return () => {
            listeners.delete(refreshRegion);
            if (region !== null) {
              region();
              region = null;
            }
          };
        });

        // Two shipped navigation methods carry chat mode's two refusals.
        //
        // `startSession` is where every New Session entry point lands — the
        // sidebar shell's own button included — so that is where 日常 has to be
        // honoured. `openWorkspace` is where every project switch lands: the
        // new-chat row's 项目 chip, the empty composer's workspace prompt and
        // the directory picker all funnel into it, and a daily chat may not
        // leave its own workspace through any of them. Both patches live on the
        // service PROTOTYPE: Cordis hands each consumer a fresh traceable proxy
        // of one shared instance, and the sidebar captured its proxy long
        // before this plugin loaded.
        ctx.inject(['uiWorkspace'], (workspaceCtx) => {
          workspaceCtx.effect(() => {
            const proto = Object.getPrototypeOf(workspaceCtx.uiWorkspace);
            const original = proto === null ? undefined : proto.startSession;
            if (typeof original !== 'function') return undefined;
            const originalOpenWorkspace = proto.openWorkspace;

            originalStartSession = original;
            proto.startSession = function startSession(workspaceId) {
              if (state.mode === 'daily' && !starting) {
                void startDailyChat();
                return undefined;
              }
              return original.call(this, workspaceId);
            };

            // Refused rather than redirected: the caller asked for another
            // project, and the honest answer is that a daily chat does not have
            // one. The rejection is also what puts the pickers back in step —
            // they clear the choice they optimistically showed on a rejection —
            // and the toast is the only place the reason can be read, since the
            // pickers swallow their own failure.
            if (typeof originalOpenWorkspace === 'function') {
              proto.openWorkspace = function openWorkspace(workspaceId, beforeOpen) {
                if (state.mode === 'daily' && !staysDaily(workspaceId)) {
                  const refusal = new Error(t('lockedProject'));
                  setState({ error: refusal.message });
                  return Promise.reject(refusal);
                }
                return originalOpenWorkspace.call(this, workspaceId, beforeOpen);
              };
            }

            return () => {
              proto.startSession = original;
              if (typeof originalOpenWorkspace === 'function') {
                proto.openWorkspace = originalOpenWorkspace;
              }
              originalStartSession = undefined;
            };
          }, 'daily-chat: New Session routing and the project lock');
        });
      },
    };
  },
});
