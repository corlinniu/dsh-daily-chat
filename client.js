/**
 * Client half of the daily-chat plugin.
 *
 * The product idea: DSH's New Session has one meaning — the full coding agent.
 * This plugin splits it into two, the way ChatGPT splits chat from work:
 *
 *   日常  a lightweight conversation agent. Its own agent preset (`daily`) is
 *         composed of a chat persona, the web tools, local file read/write
 *         (read/write/edit/glob/grep), the question tool and compaction — no
 *         shell, no plan mode, no subagents. The loop is
 *         用户消息 → 模型 → 工具调用 → 回复.
 *   工作  exactly the shipped behaviour, untouched.
 *
 * Five contributions hold that up:
 *
 * 1. Two labeled rows. The shipped New Session button is hand-written JSX
 *    inside the sidebar shell and is wrapped by no slot, so nothing can be added
 *    beside it; the sidebar's own additive seats are the only places a plugin
 *    may appear. The one that renders a full-width icon + label row is
 *    `sidebar.panellist`, so 「日常聊天」 and 「开始工作」 live there, ordered
 *    above 「插件」 by a negative `order` (the shell sorts by it ascending, and
 *    panels default to 0). A panellist row's click is the shell's and is fixed
 *    to `selectPanel(id)`, which is why contribution 2 exists.
 *
 *    The rest of that list is the shell's, with one arrangement: the two system
 *    rows 「插件」 and 「自动化任务」 are moved into DSH's own 「更多」 row. Both
 *    panels stay; only their rows leave the list, and their menu rows are
 *    contributed through the menu's additive seat (`sidebar.panellist.actions`)
 *    with label and glyph read back from the shell's ledger, so they look and
 *    read like the rows they replace. The hide rule is matched on that label —
 *    the only DOM handle a row has — and is published only while the expansion
 *    can carry the rows, so a shell without that seat keeps every row where it
 *    was.
 *
 *    That row then opens DOWNWARD, as a continuation of the list instead of a
 *    second-level popup, and it reads 「收起」 while it is open: {@link
 *    MoreExpansion} takes the row's click before the shell's menu can open and
 *    paints the expanded rows itself, under the row. Being the owner is the
 *    point — the shell's menu closes on a row click, on an outside click and on
 *    `Esc`, and the expansion must close on none of them: 「收起」 is the only
 *    way out, plus the sidebar collapsing out from under it.
 *
 *    A second, smaller pair of passes removes the same plugin's two
 *    plugin-discovery rows from the conversation view tab row's 「更多」 menu —
 *    a different seat with the same complaint — and hides that launcher up
 *    front whenever no view tab is folded behind it (`mountViewActions` for the
 *    rows, `ViewMoreWatch` for the launcher).
 * 2. Two `main` panels under those ids, one per row. Both are transient: a row
 *    ACTS rather than navigates, so the panel performs the action and hands the
 *    centre column straight back to the conversation. That is what makes the
 *    mode rows land in the composer, with no page in between.
 * 3. The daily session list in `sidebar.workspaces`. Work mode leaves that slot
 *    completely alone: our entry is registered with `priority: -1`, and for a
 *    `single` slot the LOWEST live priority renders, so ours wins while it is
 *    registered and the shipped browser returns the moment it is disposed. A
 *    row is that browser's own row minus what a daily chat cannot do: status
 *    dot, title, and the same trailing relative age (`relativeTime` plus the
 *    same thresholds), refreshed on a clock because this list can sit idle.
 * 4. A prototype patch of `uiWorkspace.startSession` — the one method every New
 *    Session entry point calls, the sidebar shell's own button included — so
 *    that button starts a daily chat instead of a work session while 日常 is
 *    the active mode.
 * 5. The elapsed line in a settled Turn's footer. DSH measures a Turn's duration
 *    already — `turn.end.time - turn.start.time`, floored at a second — but
 *    paints it only inside the Turn process header, which every shipped display
 *    mode except 「完全展开」 folds away the moment the Turn settles, so the
 *    figure is unreadable exactly when it is wanted. `conversation.chat.turnTail`
 *    is the one seat a settled Turn always paints, and the `turn` prop it hands
 *    over is the same location the header reads, so the line moves an existing
 *    number instead of measuring a second time. The seat that would hold it on
 *    the row with the usage figure and the clock is the row's own, and the only
 *    way into that row is its `extraActions`, fed by
 *    `conversation.chat.assistant-actions` — so the figure is published from the
 *    first seat and painted by the second, which is what {@link TurnDuration}
 *    and {@link TurnElapsed} are. It is not mode-gated on purpose: the question
 *    it answers does not depend on the mode.
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
    /**
     * `react-dom`'s portal, when the shared module table carries it. The
     * expansion has to reach ABOVE the sidebar column, and the frame's overlay
     * layer sits below it (the sidebar is z-index 71, the overlay layer 20), so
     * the only place the rows can paint over the list is a portal to `<body>`
     * — exactly what the shell's own menu does. A build whose module table
     * omits `react-dom` simply leaves that menu in charge.
     */
    let createPortal = null;
    try {
      const ReactDOM = require('react-dom');
      if (ReactDOM !== null && typeof ReactDOM.createPortal === 'function') createPortal = ReactDOM.createPortal;
    } catch (reason) {
      console.warn('[daily-chat] react-dom is not on the module table:', reason);
    }

    /** Locale namespace for this plugin's own copy. */
    const LOCALE_NS = 'dailyChat';
    /** The single localStorage key holding the active mode. */
    const MODE_KEY = 'dsh.daily-chat.mode';
    /**
     * The single localStorage key holding the archived-row filter. It is kept
     * apart from the mode because the two are independent: switching to work
     * and back must not reset which archived chats the list is showing.
     */
    const ARCHIVED_FILTER_KEY = 'dsh.daily-chat.archived-filter';
    /**
     * The three visibility choices for archived chats, spelled exactly as the
     * workspace browser spells its own: `default` hides them, `show` mixes them
     * into the list, `only` shows nothing else. Same values, same semantics.
     */
    const ARCHIVED_FILTERS = ['default', 'show', 'only'];
    /** How long a success notice stays up, matching the workspace browser's toast. */
    const TOAST_HOLD_MS = 6000;
    /** The `<html>` attribute the mode-scoped chrome rules hang off. */
    const MODE_ATTRIBUTE = 'data-dsc-mode';
    /** The agent preset a daily chat runs on. */
    const DAILY_PRESET = 'daily';
    /** The workspace directory basename that identifies the daily workspace. */
    const DAILY_DIRECTORY = 'daily-chat';
    /** The title the Host half registers the daily workspace with. */
    const DAILY_TITLE = '日常聊天';
    /** The `main` panel the 「日常聊天」 sidebar row opens. */
    const DAILY_PANEL = 'daily-chat';
    /** The `main` panel the 「开始工作」 sidebar row transiently opens. */
    const WORK_PANEL = 'daily-chat-work';
    /**
     * The shell's own panel launchers that this plugin moves into DSH's native
     * 「更多」 row: the plugin manager page and the automation-task page. Both
     * keep their panels — only their rows leave the panel list, and both rows
     * come back when the expansion cannot carry them (an older DSH, a primitives
     * build without `MenuItemButton`).
     */
    const MOVED_PANEL_IDS = ['plugins', 'schedules'];
    /** Where the two moved rows sit in the 「更多」 expansion, above its own actions. */
    const MOVED_MENU_ORDER = -10;
    /** The registration id this plugin's contribution to the menu seat carries. */
    const MOVED_ACTIONS_ID = 'daily-chat-moved-panels';
    /**
     * The marker on the 「更多」 row itself while the expansion is open: it is
     * what paints the row as the open one (the shell's own `aria-expanded`
     * highlight is keyed on a menu that never opens here).
     */
    const MORE_OPEN_ROW_ATTR = 'data-dsc-more-row';
    /**
     * The marker (and the text it carries) that turns the 「更多」 row's label into
     * 「收起」 while the expansion is open. It sits on the label span itself, so
     * the `::after` rule can read the text back with `attr()` — and it goes away
     * when the expansion closes, leaving the row's own label alone.
     */
    const MORE_OPEN_ATTR = 'data-dsc-more-open';
    /**
     * Panel-list width below which 「更多」 keeps its native popup: the collapsed
     * sidebar is an icon rail and has no width to expand into.
     */
    const MORE_MIN_WIDTH = 120;
    /** The attribute a menu surface carries all by itself (see the primitives `Menu`). */
    const MENU_SURFACE_ATTR = 'data-menu-material';
    /**
     * The shipped plugin whose two discovery rows the shell's menu carries next
     * to this plugin's own. They are reproduced in the expansion by their own
     * copy and their own `pluginNavigation` / `startSession` calls; a menu
     * holding any OTHER plugin's row is left to the shell, because a row this
     * pass does not know cannot be reproduced outside that menu.
     */
    const ENTRY_CUSTOMIZATION_ID = 'entry-customization';
    /** The preset the discovery row's creator chat runs on, as DSH spells it. */
    const CREATOR_PRESET = 'cordis';
    /**
     * Markers for the conversation view tab row's own 「更多」 menu: the two
     * plugin-discovery rows this plugin removes from it, the empty-launcher
     * state (nothing left to open), and the surface while it is being retired.
     */
    const VIEW_ACTION_ATTR = 'data-dsc-hide-entry-action';
    const VIEW_MORE_EMPTY_ATTR = 'data-dsc-view-more-empty';
    const VIEW_MORE_MENU_ATTR = 'data-dsc-view-more-menu';
    /**
     * Hashed class halves that identify that menu and its launcher. Only the
     * suffix is stable across DSH builds; the hash in front changes with the
     * stylesheet.
     */
    const VIEW_MORE_MENU_CLASS = 'viewsMoreMenu';
    const VIEW_MORE_ANCHOR_CLASS = 'viewsMoreAnchor';
    /** The attribute the conversation shell puts on its view tablist. */
    const CONVERSATION_TABS_ATTR = 'data-conversation-tabs';
    /** The class the elapsed line and its two parts carry. */
    const TURN_CLASS = 'dsc-took';
    /** The line as the turnTail seat paints it: under the action row, on its own. */
    const TURN_FALLBACK_CLASS = 'dsc-took-fallback';
    /** The line as the action row paints it: in-row, after the usage figure. */
    const TURN_INLINE_CLASS = 'dsc-took-inline';
    /** The hidden carrier the turnTail seat publishes its numbers through. */
    const TURN_FACT_CLASS = 'dsc-took-facts';
    /** The attribute a settled Turn's container carries. */
    const TURN_ROOT_MARKER = 'data-turn-tail';
    /** Milliseconds this Turn took, on the carrier. */
    const TURN_FACT_ELAPSED = 'data-dsc-elapsed';
    /** Why this Turn ended (`aborted` / `error` / empty), on the carrier. */
    const TURN_FACT_REASON = 'data-dsc-reason';
    /** When this Turn started, epoch ms, on the carrier. */
    const TURN_FACT_START = 'data-dsc-start';
    /** When this Turn ended, epoch ms, on the carrier. */
    const TURN_FACT_END = 'data-dsc-end';
    /** The turnTail seat's contribution id — the carrier, not the painted line. */
    const TURN_CONTRIBUTION = 'daily-chat-turn-took';
    /** The action row's contribution id — the painted line. */
    const TURN_INLINE_CONTRIBUTION = 'daily-chat-turn-took-inline';
    /**
     * Where the elapsed line sits among its seat's contributions: last, so it
     * comes after another plugin's block instead of splitting the reply from it.
     * Which of the two seats it ends up painting in is not this number's doing —
     * see {@link TURN_CSS} and {@link TurnElapsed}.
     */
    const TURN_ORDER = 20;

    const zh = {
      dismiss: '知道了',
      dailyChats: '日常聊天',
      startWork: '开始工作',
      moreCollapse: '收起',
      moreGroup: '更多',
      newChat: '新建日常聊天',
      // Row actions. The words are the workspace browser's own, so the two
      // lists read the same way; only the controls differ in where they sit.
      pin: '置顶会话',
      unpin: '取消置顶',
      archive: '归档会话',
      unarchive: '取消归档',
      pinned: '已置顶',
      pinFailed: '置顶失败，请稍后重试',
      unpinFailed: '取消置顶失败，请稍后重试',
      archiveFailed: '归档失败，请稍后重试',
      unarchiveFailed: '取消归档失败，请稍后重试',
      archiveActiveBlocked: '这个会话还在运行，停止后才能归档。',
      // The archive notice is the shipped one, word for word: the toast reads
      // 「会话已归档，可 [撤销] 或 [筛选已归档会话]」, with the two action
      // buttons inline — not a bespoke card with separate buttons.
      archivedNotice: '会话已归档，可',
      stoppedArchivedNotice: '已停止并归档，可',
      toastOr: '或',
      undo: '撤销',
      filterArchived: '筛选已归档会话',
      archivedNotOpenable: '已归档对话暂时无法查看，请取消归档后查看',
      // Archived-row filtering, the same three choices the workspace browser
      // offers under its 「视图选项」 menu.
      viewOptions: '视图选项',
      filterLabel: '筛选会话',
      hideArchived: '隐藏已归档',
      showArchived: '全部对话（显示已归档）',
      onlyArchived: '仅显示已归档',
      noneArchived: '暂无已归档会话',
      viewOthers: '查看其他会话',
      // The confirmation the workspace browser raises before archiving a
      // session that is still working.
      archiveConfirmTitle: '停止并归档此会话？',
      archiveConfirmDesc: '“{title}”仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏筛选“全部对话（显示已归档）”中恢复会话，被停止的工作不会自动继续。',
      archiveConfirmActivity: '将被停止的工作',
      archiveConfirmTurn: '进行中的回合',
      archiveConfirmSubagents: '{n} 个运行中的子智能体：{names}',
      archiveConfirmJobs: '{n} 个后台任务：{names}',
      archiveConfirmSchedules: '{n} 条定时提醒：{names}',
      archiveConfirmOther: '{n} 项其他工作（{kind}）',
      archiveConfirmListSeparator: '、',
      archiveConfirmAction: '停止并归档',
      archiveConfirmPending: '正在停止并归档…',
      cancel: '取消',
      lockedProject: '日常聊天固定在自己的工作区，不能切换项目。要开始工作，请点侧边栏的「开始工作」。',
      starting: '正在打开日常聊天…',
      startingWork: '正在切换到工作模式…',
      empty: '还没有日常聊天，点上面开始第一句。',
      needWorkspace: '没能准备好日常聊天目录，请在弹出的选择框里挑一个文件夹。',
      failed: '打开日常聊天失败',
      turnTook: '用时',
      turnStopped: '已中断，用时',
      turnFailed: '已出错，用时',
      timeNow: '刚刚',
      timeMinutes: '{n}分钟',
      timeHours: '{n}小时',
      timeDays: '{n}天',
      timeMonths: '{n}个月',
      timeYears: '{n}年',
      hourUnit: '小时',
      minuteUnit: '分',
      secondUnit: '秒',
    };

    const en = {
      dismiss: 'Dismiss',
      dailyChats: 'Chats',
      startWork: 'Start working',
      moreCollapse: 'Collapse',
      moreGroup: 'More',
      newChat: 'New chat',
      pin: 'Pin session',
      unpin: 'Unpin session',
      archive: 'Archive session',
      unarchive: 'Unarchive session',
      pinned: 'Pinned',
      pinFailed: 'Could not pin the session. Try again.',
      unpinFailed: 'Could not unpin the session. Try again.',
      archiveFailed: 'Could not archive the session. Try again.',
      unarchiveFailed: 'Could not unarchive the session. Try again.',
      archiveActiveBlocked: 'This chat is still working. Stop it before archiving.',
      archivedNotice: 'Session archived. You can ',
      stoppedArchivedNotice: 'Stopped and archived. You can ',
      toastOr: ' or ',
      undo: 'Undo',
      filterArchived: 'Filter archived sessions',
      archivedNotOpenable: 'Archived sessions cannot be opened. Unarchive it to view.',
      viewOptions: 'View options',
      filterLabel: 'Filter sessions',
      hideArchived: 'Hide archived',
      showArchived: 'All conversations (show archived)',
      onlyArchived: 'Only archived',
      noneArchived: 'No archived sessions yet',
      viewOthers: 'View other sessions',
      archiveConfirmTitle: 'Stop and archive this session?',
      archiveConfirmDesc: '“{title}” still has work in progress. Archiving stops that work first; the session can be recovered later under “All conversations (show archived)”. Stopped work does not resume automatically.',
      archiveConfirmActivity: 'Work that will be stopped',
      archiveConfirmTurn: 'A running turn',
      archiveConfirmSubagents: '{n} running subagents: {names}',
      archiveConfirmJobs: '{n} background jobs: {names}',
      archiveConfirmSchedules: '{n} scheduled reminders: {names}',
      archiveConfirmOther: '{n} other work items ({kind})',
      archiveConfirmListSeparator: ', ',
      archiveConfirmAction: 'Stop and archive',
      archiveConfirmPending: 'Stopping and archiving…',
      cancel: 'Cancel',
      lockedProject: 'A chat stays in its own workspace — use “Start working” in the sidebar to open a project.',
      starting: 'Opening chat…',
      startingWork: 'Switching to work…',
      empty: 'No chats yet. Start one above.',
      needWorkspace: 'Could not prepare the chat folder — pick one in the dialog.',
      failed: 'Could not open the chat',
      turnTook: 'Took',
      turnStopped: 'Stopped after',
      turnFailed: 'Failed after',
      timeNow: 'now',
      timeMinutes: '{n}min',
      timeHours: '{n}h',
      timeDays: '{n}d',
      timeMonths: '{n}mo',
      timeYears: '{n}y',
      hourUnit: 'h ',
      minuteUnit: 'm ',
      secondUnit: 's',
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
      // A notice that carries actions (undo / filter) stacks them under its
      // text, the way the workspace browser's own toast does.
      '.dsc-toast-body{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.dsc-toast-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}',
      '.dsc-toast-action{padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-link);cursor:pointer;background:transparent;border:0}',
      '.dsc-toast-action:hover{text-decoration:underline}',
      '.dsc-toast-close{flex:none;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:0}',
      '.dsc-toast-close:hover{color:var(--dsw-alias-label-primary)}',

      // The region and its section header mirror the shipped browser's own
      // geometry, declaration for declaration. `.bhn1Oq_root` insets itself by
      // `--dsh-sidebar-inline-padding`, which `regionArea` has already handed
      // back to the sidebar's own gutter; `.bhn1Oq_sectionHeader` is a 36px row
      // with `margin-bottom:4px` and `padding-left:4px`; and its label carries no
      // type of its own — it inherits the sidebar's 14px and the header's
      // tertiary ink, with `max-width:45%` so it can never crowd the controls.
      //
      // One rule in that stylesheet is NOT mirrored, because it does not land:
      // `.bhn1Oq_root:not(.bhn1Oq_rail) .bhn1Oq_sectionHeader` also declares
      // `margin-right:-4px`, yet measuring a 工作 capture puts the shipped add
      // button's right edge flush with the sidebar's content box (18.5px inside
      // the sidebar's outer edge), not 4px past it. Copying the declaration
      // instead of the measurement left 「日常聊天」's own control 4px tighter
      // than 工作's, which is exactly what this row's right margin must not be.
      // The three numbers the shipped browser publishes on its own root and the
      // list spends. Declared here for the same reason: our list has to reserve
      // exactly the same room for its scrollbar.
      '.dsc-region{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding,12px);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;display:flex;flex-direction:column;min-height:0;height:100%;padding:0 var(--dsh-sidebar-inline-padding,12px) 0 0}',
      '.dsc-region.dsc-rail{padding-right:0}',
      // One deliberate difference from the shipped rail header: that one drops
      // its actions entirely, while this header always has the add control to
      // place. With the label hidden in the rail the single remaining child sits
      // at the start either way, so the distribution needs no rail override.
      '.dsc-head{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:4px;height:36px;margin-top:2px;margin-bottom:4px;padding-left:4px;color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;overflow:hidden}',
      '.dsc-title{white-space:nowrap;min-width:0;max-width:45%;flex:none;line-height:20px;overflow:hidden}',
      // The header's controls: the archive-filter menu and the add button, in
      // the workspace browser's own order (view options, then add).
      '.dsc-headactions{display:flex;flex:none;align-items:center;gap:4px}',
      // A rail is for picking a mode, not for browsing or for starting one. The
      // shipped browser renders neither its label nor its list when collapsed;
      // 日常's one remaining control in the section would be the add button, and
      // measured against a rail capture it sat 4px left of the icon column the
      // mode rows above it share — so the header goes with the list instead of
      // leaving one misaligned glyph behind it.
      '.dsc-rail .dsc-head{display:none}',
      '.dsc-rail .dsc-listArea{display:none}',
      // The section header's two controls are the shipped workspace browser's
      // own icon button, declaration for declaration (`.bhn1Oq_iconButton` in
      // @deepseek-ai/dsh-client-ui-workspace): a bare 28px control, the small
      // `--dsw-radius-sm` corner (NOT a circle — captured from the 0.2.x
      // browser's hover square), and the same hover wash. 日常 replaces that
      // browser in the sidebar, so its own header carries the same affordances
      // in the same clothes: 「视图选项」 and 「新建日常聊天」.
      '.dsc-new{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:0;border-radius:var(--dsw-radius-sm)}',
      '.dsc-new:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      // The list sits in a wrapper that mirrors `.bhn1Oq_listArea`, and that
      // wrapper is what decides where the scrollbar ends up: it pulls back out
      // by the same inset the root added, so the list's box reaches the sidebar's
      // outer edge and the list's own 2px offset then lands the gutter 2px inside
      // it. Leave the wrapper out and the scrollbar — and every row's right edge
      // — sits a whole inset too far in; that is exactly the miss this plugin
      // made twice before a side-by-side capture settled it (工作: thumb ends 2px
      // inside the sidebar edge; 日常 had 14px).
      '.dsc-listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}',
      // ...and the scroll container is the list inside it, mirroring
      // `.bhn1Oq_list`: a 2px offset margin, a gutter reserved even when nothing
      // overflows (`scrollbar-gutter:stable`, so the rows never jump when the
      // list starts or stops scrolling), and a right padding of edge-inset minus
      // scrollbar minus offset — 2px — which puts the rows' right edge where
      // 工作's rows put theirs.
      '.dsc-list{display:flex;flex-direction:column;gap:1px;flex:1;min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));padding-bottom:16px;scrollbar-gutter:stable;overflow-y:auto}',
      // The row keeps 工作's own session-row height. `YDXeBa_sessionRow` in the
      // workspace browser is a fixed 32px; this row is that row minus its slot
      // and its hover actions, so it spends those 32px the same way — the
      // title's 20px line box (below) plus 6px of vertical padding.
      // The row's hover paint is 工作's own: the same
      // `--dsw-alias-interactive-bg-hover` (a translucent ink, not a solid
      // layer) inside the same `--dsw-radius-md` corner. A selected row keeps
      // that paint standing, exactly like the workspace browser's selected row.
      //
      // The row is a `<div role="treeitem">`, not a `<button>`: it now owns two
      // nested action buttons (archive and pin), and interactive elements must
      // not nest inside a button. Enter and Space open it the way the shipped
      // session row does, and the nested buttons stop propagation themselves.
      // The row is now a `<div>` (it has to hold the two action buttons), so it
      // has to say `border-box` itself: a button used to get that from the UA
      // stylesheet, and `width:100%` + 16px of horizontal padding on a
      // content-box div would make every row 16px wider than the list and clip
      // the right-hand action against the list's edge.
      '.dsc-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;font:inherit;text-align:left;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:0;border-radius:var(--dsw-radius-md)}',
      '.dsc-row:hover,.dsc-row[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      // An archived row reads the way 工作's archived row reads: the title drops
      // to the caption ink and the status dot goes quiet. Nothing else moves —
      // it keeps its slot, its age, and its hover actions.
      '.dsc-row-archived .dsc-rowtitle{color:var(--dsw-alias-label-caption)}',
      '.dsc-row-archived .dsc-dot{background:var(--dsw-alias-label-caption);opacity:.6}',
      '.dsc-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2)}',
      '.dsc-dot-on{background:var(--dsw-alias-state-success-primary)}',
      // The title is the workspace browser's `.title`, declaration for
      // declaration (see @deepseek-ai/dsh-client-ui-workspace's
      // Rows.module.css): 14px/20px — the one type size this column draws its
      // session names in. The 13px/18px this replaces was a leftover of the
      // once-tried whole-column 13px (reverted), which left this list a size
      // smaller than the list it stands in for, in the same column.
      '.dsc-rowtitle{flex:1;min-width:0;overflow:hidden;font-size:14px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}',
      // The trailing age cell is the workspace browser's `.time`, declaration
      // for declaration (see @deepseek-ai/dsh-client-ui-workspace's
      // Rows.module.css): 10px/16px in the tertiary ink, taking no width from
      // the title. Like 工作's row, it shares a resting cell with the pinned
      // marker and gives that cell up to the row actions on hover.
      '.dsc-rowtime{flex:none;margin-inline-end:-1px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      // `.rowResting`: the age plus, when the row is pinned, the pin marker.
      // The marker is the workspace browser's own `PinnedIndicator`: a 16px
      // cell holding a 14px filled pin in the caption ink. The spacing is the
      // shipped pair, too — the resting cell is a 6px-gap flex line and the
      // marker itself sits at `margin-left:0` inside it (the shipped stylesheet
      // overrides the marker's own 6px for exactly this context), so the icon
      // lands where 工作 puts it instead of 6px further along.
      '.dsc-rowresting{flex:none;display:inline-flex;align-items:center;gap:6px}',
      '.dsc-rowpin{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;margin-left:0;color:var(--dsw-alias-label-caption)}',
      // `.rowActions`: the hover-only band the row swaps in for the resting
      // cell. Two 24px bare icon buttons with the workspace browser's 13px gap
      // and -4px optical margin, archive first, pin second — its own order.
      '.dsc-rowactions{flex:none;display:none;align-items:center;gap:13px}',
      '.dsc-rowact{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin:-4px;padding:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:0;border-radius:var(--dsw-radius-xs)}',
      '.dsc-rowact:hover{color:var(--dsw-alias-label-primary)}',
      // Same swap 工作's session row performs, with the same two triggers it
      // recognises: hover, and keyboard focus — and only keyboard focus. A
      // MOUSE click on the pin button also leaves focus inside the row, but the
      // shipped stylesheet deliberately does not count that as a resting-state
      // swap: once the pointer leaves, the row goes back to 「time + pin」 and
      // the archive button disappears again. Without the modality check the
      // just-pinned row would keep showing its action buttons after the click,
      // which is exactly the mismatch this rule fixes (the shipped selector is
      // `html[data-input-modality=keyboard] .sessionRow:focus-within …`).
      '@media (hover:hover){.dsc-row:hover .dsc-rowresting{display:none}.dsc-row:hover .dsc-rowactions{display:inline-flex}html[data-input-modality="keyboard"] .dsc-row:focus-within .dsc-rowresting{display:none}html[data-input-modality="keyboard"] .dsc-row:focus-within .dsc-rowactions{display:inline-flex}}',
      '@media (hover:none){.dsc-rowresting{display:none}.dsc-rowactions{display:inline-flex}}',

      // The page trigger. It is neither a row nor a control: a 1px strip at the
      // end of the painted window that only the observer looks at. It needs a
      // box — a zero-area target is not reliably reported as intersecting —
      // takes no pointer, paints nothing, and as a `<div>` stays out of the tab
      // order. Scrolling it into view is what asks for the next page.
      '.dsc-pager{flex:none;height:1px;pointer-events:none}',
      '.dsc-empty{padding:10px 8px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      // The archived-only empty state, borrowed whole from the workspace
      // browser's `EmptySessions`: a glyph over a line, with the way back to the
      // ordinary list underneath. Its geometry is the shipped one (centered,
      // 80px down, 13px/20px tertiary ink).
      '.dsc-emptyarchived{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:80px;padding:0 12px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
      '.dsc-emptyarchived > svg{color:var(--dsw-alias-label-caption);margin-bottom:4px}',
      '.dsc-emptylink{padding:0;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-link);cursor:pointer;background:transparent;border:0}',
      // The stop-and-archive confirmation's activity list, matching the shipped
      // dialog: a plain bulleted list under the description.
      '.dsc-archiveactivity{margin:0 0 8px;padding-left:18px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dsc-archiveactivity li{overflow-wrap:anywhere}',
      '.dsc-archivestatus{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsc-archiveerror{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
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
     *
     * The third rule drops the icon from the session header's Agent-preset chip
     * while 日常 is active, leaving its text. The chip is the shipped
     * `AgentPresetLabel` in `@deepseek-ai/dsh-client-ui-agent-preset`, and its
     * icon says "this session runs a preset"; in 日常 the answer is always the
     * same one, so the glyph is noise. It is anchored on the slot key — the same
     * `conversation.session.header.actions` this deployment registers into, and
     * the anchor DSH's own stylesheets use — rather than on the chip's hashed
     * class, and then on the chip's SHAPE: a root `<span>` carrying the preset's
     * description as its `title`, with the glyph as its own first child. The
     * other occupants of that slot (jobs, schedule, terminal, cost meter) are
     * buttons or `<div>`s, so the shape selects exactly one element.
     *
     * One more rule hides the provisional New Session row. Every New Session
     * entry — 「日常聊天」, 「开始工作」, the shell's own button — opens a Session
     * that has no content yet, and until the first prompt is accepted DSH paints
     * exactly that Session in the tree as the selected 「新会话」 placeholder: its
     * title is localized, and it carries no timestamp. That row is there from the
     * click, so a workspace browser shows a conversation the user has not had;
     * this rule is what keeps the list to conversations that exist.
     *
     * It is identified by SHAPE, not by name. `data-row-key="session:…"` is the
     * tree row's own non-hashed handle, and the timestamp cell and the row-actions
     * cell are both rendered `!row.blank && …`, so the placeholder is the only
     * Session row that carries neither. Both anchors have to be missing to match,
     * which is also what bounds the failure: renaming ONE class leaves the other
     * anchor in place, so the rule still hides the placeholder and still skips
     * every real row (a real row keeps the other cell). Only a release that
     * changes BOTH suffixes — or drops both cells — would read a real row as the
     * placeholder and hide it; the shared `!row.blank` gate is what rules that out
     * today. Nothing has to bring the row back either: `blank` clears when
     * the first prompt is ACCEPTED (a refused prompt leaves it set), and the next
     * render paints an ordinary row. The two workspace and session projections
     * above are deliberately left alone by this: DSH reuses a blank Session when
     * the same entry point is clicked again, and that reuse reads the very ids a
     * projection would have to hide.
     *
     * The tail rules dress the 「更多」 expansion: the trigger row's open state,
     * its 「收起」 label, and the row surface {@link MoreExpansion} portals to
     * `<body>`. The expansion is this plugin's own DOM — unlike the shell menu
     * it replaces — so it takes the panel list's metrics and nothing of the
     * menu's card chrome: 36px rows with the list's 2px gaps, 14px/22px type, a
     * 16px glyph, the same 8px gutters and the same hover wash, so it reads as
     * the list continued rather than as a second-level menu. The trigger's own
     * label turns into 「收起」 while it is open: the text arrives through
     * `MORE_OPEN_ATTR` on the title span, and `::after{content:attr(...)}`
     * paints it in place of the shell's own 「更多」 without touching that text
     * node. The span is a flex box so the substituted line is centered exactly
     * like a normal row label.
     */
    const CHROME_CSS = [
      'button[class*="newSession"]{display:none !important}',
      `html[${MODE_ATTRIBUTE}="daily"] [class*="heroWorkspaceRow"]{display:none !important}`,
      `html[${MODE_ATTRIBUTE}="daily"] [data-slot="conversation.session.header.actions"] > span[title] > svg{display:none !important}`,
      '[data-row-key^="session:"]:not(:has(> [class*="_time"])):not(:has(> [class*="_rowActions"])){display:none !important}',
      `nav[class*="panelList"] button[${MORE_OPEN_ROW_ATTR}]{background-color:var(--dsw-alias-interactive-bg-hover)}`,
      `nav[class*="panelList"] span[class*="panelTitle"][${MORE_OPEN_ATTR}]{display:flex;align-items:center;font-size:0 !important}`,
      `nav[class*="panelList"] span[class*="panelTitle"][${MORE_OPEN_ATTR}]::after{content:attr(${MORE_OPEN_ATTR});font-size:14px;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
      // The expansion surface. It is portaled to `<body>` and parked under the
      // trigger row every frame, so the box comes from the geometry pass; the
      // 90 sits above the sidebar column (71) and below modals, menus and
      // toasts (1000+), which is exactly where a list continuation belongs.
      '.dsc-more{position:fixed;z-index:90;display:flex;flex-direction:column;gap:2px;margin:0;padding:0;pointer-events:auto;background:transparent}',
      '.dsc-more-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:36px;margin:0;padding:7px 8px;font-family:inherit;font-size:14px;line-height:22px;text-align:left;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:0;border-radius:var(--dsw-radius-md)}',
      '.dsc-more-row:hover{background-color:var(--dsw-alias-interactive-bg-hover)}',
      '.dsc-more-row:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dsc-more-glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}',
      '.dsc-more-glyph > svg{width:16px;height:16px}',
      '.dsc-more-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      `[${VIEW_ACTION_ATTR}]{display:none !important}`,
      `[${VIEW_MORE_EMPTY_ATTR}]{display:none !important}`,
      `[${VIEW_MORE_MENU_ATTR}]{display:none !important}`,
    ].join('');

    /**
     * The elapsed line's own rules, shipped with the components rather than with
     * {@link CHROME_CSS} so the line carries its styling to whichever surface
     * paints it, and the same colour ramp as the shipped footer chrome around it.
     *
     * The line has two faces. The one that normally paints is {@link TurnElapsed},
     * inside the copy/branch/time row, where `order: 1` puts it after that row's
     * own usage figure and clock — the row is a flex line and the slot's anchor
     * div is `display: contents`, so this rule lands on the flex item itself. The
     * other face, {@link TurnDuration}'s, is the stand-in used when the row is not
     * there to paint into (a Turn the chat view has not finalized, a surface that
     * renders the seat without a row): it stays on its own line under the row,
     * where the negative top margin shaves the column's 16px gap down to the same
     * 4px the row's own `margin-top: 4px` sets. The first face, once painted,
     * retires the second — no surface shows both.
     */
    const TURN_CSS = [
      `.${TURN_FACT_CLASS}{display:none}`,
      `.${TURN_FALLBACK_CLASS}{order:1;display:flex;align-items:baseline;gap:6px;margin:-12px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}`,
      `.${TURN_INLINE_CLASS}{order:1;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}`,
      `[${TURN_ROOT_MARKER}]:has(.${TURN_INLINE_CLASS}) .${TURN_FALLBACK_CLASS}{display:none}`,
      `.${TURN_CLASS}-label{color:var(--dsw-alias-label-secondary)}`,
      `.${TURN_CLASS}-value{color:var(--dsw-alias-label-tertiary)}`,
    ].join('');

    /* ── relative time ────────────────────────────────────────────────────── */

    /**
     * The workspace browser's own bucketing, when primitives ships it: below a
     * minute reads 「刚刚」, then minutes below the hour, hours below the day,
     * days below 30, months below the year, then years. Sharing the helper is
     * what makes a daily row and a 工作 row age in the same words at the same
     * thresholds instead of two similar-but-not-equal ladders.
     */
    const bucketOf = typeof primitives.relativeTime === 'function'
      ? primitives.relativeTime
      : fallbackBucket;

    /**
     * Local bucketing used only when the primitives module carries no helper.
     * Same thresholds and units as `relativeTime`, so the fallback changes
     * nothing about what a row reads — only where the number came from.
     * @param at - the row's `updatedAt`, epoch ms.
     * @param now - current epoch ms.
     * @returns the bucket unit and its magnitude.
     */
    function fallbackBucket(at, now) {
      const diff = Math.max(0, now - at);
      const minutes = Math.floor(diff / 60000);
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

    /** The dictionary key for one bucket; the magnitude stays a number. */
    const UNIT_KEYS = {
      minutes: 'timeMinutes',
      hours: 'timeHours',
      days: 'timeDays',
      months: 'timeMonths',
      years: 'timeYears',
    };

    /**
     * Localize one row's age in the compact form the workspace rows use —
     * `5分钟` / `3小时` / `22天`, never a trailing 「前」: the cell sits beside
     * the title, not in a sentence. The magnitude goes through the dictionary
     * rather than a hand-built number + word pair, so a language pack can put
     * the number anywhere in its own template.
     * @param at - the row's `updatedAt`, epoch ms; anything non-finite paints nothing.
     * @param now - current epoch ms.
     * @param t - this plugin's bound translator.
     * @returns the trailing label, or an empty string when there is no usable time.
     */
    function timeLabel(at, now, t) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return '';
      const bucket = bucketOf(at, now);
      if (bucket.unit === 'now') return t('timeNow');
      const key = UNIT_KEYS[bucket.unit];
      return key === undefined ? '' : t(key, { n: bucket.n });
    }

    /**
     * How often the rows re-read the clock. A relative label names whole
     * minutes (or hours / days), so half a minute keeps it correct to its own
     * granularity without repainting a mounted sidebar on every frame.
     */
    const RELATIVE_CLOCK_PERIOD_MS = 30000;

    /**
     * Current epoch ms, re-sampled on {@link RELATIVE_CLOCK_PERIOD_MS}.
     *
     * The workspace browser samples `Date.now()` while it renders and gets away
     * with it: that tree repaints on every session and workspace event. The
     * daily list can sit untouched for hours — a chat opened at 09:00 and never
     * touched again would keep saying `5分钟` — so it owns a clock instead. The
     * cost is one callback per period while the region is mounted, and the
     * region only exists in 日常: switching to 工作 unmounts it and the timer
     * goes with it.
     * @returns epoch milliseconds, updated once per period.
     */
    function useRelativeClock() {
      const [now, setNow] = React.useState(() => Date.now());
      React.useEffect(() => {
        const timer = setInterval(() => { setNow(Date.now()); }, RELATIVE_CLOCK_PERIOD_MS);
        return () => { clearInterval(timer); };
      }, []);
      return now;
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

    /**
     * Read the persisted archived-row filter. Anything unknown — an older value,
     * a cleared storage, a hand-edited string — means the shipped default:
     * archived chats are hidden, exactly like 工作's out-of-the-box view.
     * @returns one of {@link ARCHIVED_FILTERS}.
     */
    function readArchivedFilter() {
      try {
        if (typeof localStorage === 'undefined') return 'default';
        const saved = localStorage.getItem(ARCHIVED_FILTER_KEY);
        return ARCHIVED_FILTERS.indexOf(saved) === -1 ? 'default' : saved;
      } catch (reason) {
        console.warn('[daily-chat] reading the saved archived filter failed:', reason);
        return 'default';
      }
    }

    let state = {
      mode: readMode(),
      busy: false,
      error: null,
      moreMenuReady: false,
      /** Whether the 「更多」 expansion is open. Only 「收起」 sets it back. */
      moreExpanded: false,
      /** Which of {@link ARCHIVED_FILTERS} the daily list is showing. */
      archivedFilter: readArchivedFilter(),
      /** The transient success notice: `{ seq, text, actions }`, or null. */
      notice: null,
      /** A pending stop-and-archive confirmation: `{ sessionId, displayTitle, activity }`, or null. */
      archiveRequest: null,
    };
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

    /** Merge one state patch, persist the mode and the filter, and notify every reader. */
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
      if (patch.archivedFilter !== undefined) {
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(ARCHIVED_FILTER_KEY, patch.archivedFilter);
        } catch (reason) {
          console.warn('[daily-chat] saving the archived filter failed:', reason);
        }
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
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'pending', error: null,
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
     * The 「add」 glyph the shipped workspace browser draws in its section
     * header. Taken from the primitives module rather than hand-drawn, because
     * the point of the control is that it looks like the one 日常 replaced; a
     * deployment whose primitives predate it falls back to a bare plus.
     *
     * Two export names cover the two generations of that glyph in DSH:
     * `IconProjectAddOutline16` (the name this plugin has always used) and the
     * current `IconProjectAddOutlineRegular`, which is what the shipped header
     * itself draws in 0.2.x. Without the second fallback the button degrades to
     * a text plus on a current install instead of matching its neighbour.
     */
    const AddGlyph = typeof primitives.IconProjectAddOutline16 === 'function'
      ? primitives.IconProjectAddOutline16
      : (typeof primitives.IconProjectAddOutlineRegular === 'function'
        ? primitives.IconProjectAddOutlineRegular
        : null);

    /**
     * One primitives glyph, or null when this deployment predates it. Used for
     * the pin/archive artwork the workspace browser draws on its own rows: a
     * build without those exports loses the buttons and keeps the list, never
     * the other way round.
     */
    function primitiveGlyph(name) {
      return typeof primitives[name] === 'function' ? primitives[name] : null;
    }

    /** The pin glyphs: outline on an ordinary row, filled once pinned. */
    const PinGlyph = primitiveGlyph('IconPinOutlineRegular');
    const PinFilledGlyph = primitiveGlyph('IconPinFillRegular');
    /** Archive / unarchive row glyphs, plus the three filter-menu glyphs. */
    const ArchiveGlyph = primitiveGlyph('IconArchiveOutlineRegular');
    const UnarchiveGlyph = primitiveGlyph('IconUnarchiveOutlineRegular');
    const ArchiveOffGlyph = primitiveGlyph('IconArchiveOffOutlineRegular');
    const QueueGlyph = primitiveGlyph('IconQueueOutlineRegular');
    const ArchiveCheckGlyph = primitiveGlyph('IconArchiveCheckOutlineRegular');
    /** The workspace browser's 「视图选项」 glyph, reused for the filter control. */
    const SlidersGlyph = primitiveGlyph('IconSlidersTwoOutlineRegular');
    /** The warning glyph the shipped failure toasts put in front of their text. */
    const WarningGlyph = primitiveGlyph('IconWarningOutlineRegular');
    /**
     * The two glyphs `entry-customization` draws on its own menu rows — the
     * pinwheel for 「浏览更多插件」 and the plus for 「创建你的插件」. The
     * expansion reproduces those rows, so it borrows the same artwork; a build
     * without either glyph keeps the row's text and an empty 16px cell.
     */
    const DiscoveryBrowseGlyph = primitiveGlyph('IconPluginPinwheelOutlineRegular');
    const DiscoveryCreateGlyph = primitiveGlyph('IconPlusOutlineRegular');
    /** Shared primitives the row actions and filter menu need, when present. */
    const TooltipComponent = typeof primitives.Tooltip === 'function' ? primitives.Tooltip : null;
    const MenuComponent = typeof primitives.Menu === 'function' ? primitives.Menu : null;
    const ModalComponent = typeof primitives.Modal === 'function' ? primitives.Modal : null;
    const ButtonComponent = typeof primitives.Button === 'function' ? primitives.Button : null;
    /**
     * The shipped toast the workspace browser raises for its own row actions.
     * Using it — rather than a card of our own — is what makes 「归档」's
     * 「会话已归档，可 [撤销] 或 [筛选已归档会话]」 read and sit exactly like
     * the one 工作 shows: top-center, success mark, inline action buttons.
     */
    const ToastComponent = typeof primitives.Toast === 'function' ? primitives.Toast : null;

    /**
     * Hang a label on one control, with the workspace browser's own tooltip
     * behaviour (bottom, end-aligned, half-second delay). Without the primitive
     * the control keeps its `title`/`aria-label`, so nothing becomes unusable.
     * @param label - text to show.
     * @param child - the control element.
     * @returns the wrapped control, or the control itself.
     */
    function withTooltip(label, child) {
      if (TooltipComponent === null) return child;
      return h(TooltipComponent, {
        label,
        side: 'bottom',
        align: 'end',
        delayMs: 500,
        portal: true,
      }, child);
    }

    /**
     * The menu row the shell's own 「更多」 uses. Borrowed from the shared
     * primitives module so the two moved rows join that menu's styling and
     * keyboard walk; a primitives build without it leaves both the rows and
     * the panel list exactly as the shell painted them.
     */
    const MenuItemButton = typeof primitives.MenuItemButton === 'function'
      ? primitives.MenuItemButton
      : null;

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

    /* ── settled-turn elapsed line ────────────────────────────────────────── */

    /**
     * Render an elapsed span the way the shipped Turn process header does.
     *
     * The units and their trailing spacing are copied from DSH's own `duration.*`
     * messages rather than invented: the shipped header prints hours only past an
     * hour, minutes only past a minute, and always prints the seconds — so 90s is
     * 「1分30秒」 and 3600s is 「1小时0分0秒」. English units carry a trailing space
     * ("1h 2m 5s"); Chinese ones do not ("1小时2分5秒").
     *
     * @param ms - elapsed milliseconds; negatives clamp and fractions floor.
     * @param t - translate seat bound to {@link LOCALE_NS}.
     * @returns the figure as text, ready to concatenate onto its label.
     */
    function formatElapsed(ms, t) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor(total / 60) % 60;
      const seconds = total % 60;
      let text = '';
      if (hours > 0) text += String(hours) + t('hourUnit');
      if (total >= 60) text += String(minutes) + t('minuteUnit');
      return text + String(seconds) + t('secondUnit');
    }

    /**
     * Which of the three labels a Turn's elapsed line opens with.
     *
     * Aborted and failed Turns DO keep their figure here, unlike in the shipped
     * header, where the two are labelled 「已停止」/「失败」 with no number: the
     * question this line answers is how long the Turn took, and an interrupted
     * Turn took exactly as long as it took. The label says which happened so the
     * number is not read as a completed answer.
     */
    function turnLabel(reason, t) {
      if (reason === 'aborted') return t('turnStopped');
      if (reason === 'error') return t('turnFailed');
      return t('turnTook');
    }

    /** The absolute span a Turn's elapsed line summarizes, for its tooltip. */
    function turnTitle(start, end) {
      if (start === undefined || end === undefined) return undefined;
      return `${new Date(start).toLocaleString()} → ${new Date(end).toLocaleString()}`;
    }

    /** Whether two readings off the carrier are the same reading. */
    function sameTurnFacts(left, right) {
      if (left === right) return true;
      if (left === undefined || right === undefined) return false;
      return left.elapsed === right.elapsed
        && left.reason === right.reason
        && left.start === right.start
        && left.end === right.end;
    }

    /**
     * Read back the numbers {@link TurnDuration} published for the Turn this
     * action row closes.
     *
     * The action row's seat is told which *message* it belongs to, not which
     * Turn, and the chat store keeps no message-to-Turn index (the only way
     * across is a walk of every node in the session). The carrier makes the
     * crossing free instead of merely cheap: both seats are rendered by DSH into
     * the same `[data-turn-tail]` box, the carrier is already in the DOM by the
     * time this row's layout effect runs, and one `closest` plus one `querySelector`
     * is all it takes to get from the row to the numbers.
     *
     * @param element - the row's own node, or null before it exists.
     * @returns the reading, or undefined when this Turn has no carrier to read.
     */
    function readTurnFacts(element) {
      if (element === null || element === undefined) return undefined;
      const container = element.closest('[' + TURN_ROOT_MARKER + ']');
      if (container === null) return undefined;
      const carrier = container.querySelector('.' + TURN_FACT_CLASS);
      if (carrier === null) return undefined;
      const elapsed = Number(carrier.getAttribute(TURN_FACT_ELAPSED));
      if (!Number.isFinite(elapsed)) return undefined;
      const reason = carrier.getAttribute(TURN_FACT_REASON);
      const start = Number(carrier.getAttribute(TURN_FACT_START));
      const end = Number(carrier.getAttribute(TURN_FACT_END));
      return {
        elapsed: elapsed,
        reason: reason === null || reason === '' ? undefined : reason,
        start: Number.isFinite(start) ? start : undefined,
        end: Number.isFinite(end) ? end : undefined,
      };
    }

    /**
     * The elapsed figure of a settled Turn, published for whichever of the two
     * faces ends up painting it.
     *
     * DSH already measures this — `turn.end.time - turn.start.time`, floored at
     * one second — but paints it only inside the Turn process header, and every
     * shipped display mode except 「完全展开」 folds that header away the moment a
     * Turn settles. A settled Turn therefore shows no duration at all anywhere.
     * This component is the carrier half: it reads the two timestamps off the
     * `conversation.chat.turnTail` seat, states them on a hidden node, and keeps
     * a visible line of its own only as a fallback for the surfaces where
     * {@link TurnElapsed} cannot reach that node.
     *
     * Nothing is invented and nothing is faked: a Turn whose `turn/start` fell
     * outside the loaded window carries no `start`, and one that never settled
     * carries no `end` — both draw nothing rather than a zero.
     *
     * @param props.turn - the settled Turn location, straight from the seat.
     * @param props.t - translate seat bound to {@link LOCALE_NS}.
     * @returns the carrier and its fallback line, or null when there is nothing
     *   to show.
     */
    function TurnDuration(props) {
      const turn = props.turn;
      const t = props.t;
      if (turn === undefined || turn.status !== 'closed') return null;
      if (turn.start === undefined || turn.end === undefined) return null;
      const reason = turn.end.data === undefined || turn.end.data.reason === undefined
        ? undefined
        : turn.end.data.reason.kind;
      // The shipped header's floor, for the same reason: a pause that took less
      // than a second reads as 0, and 0 reads as a bug.
      const elapsed = Math.max(1000, turn.end.time - turn.start.time);
      return h(React.Fragment, null, [
        h('style', { key: 'css' }, TURN_CSS),
        h('span', {
          key: 'facts',
          className: TURN_FACT_CLASS,
          [TURN_FACT_ELAPSED]: String(elapsed),
          [TURN_FACT_REASON]: reason === undefined ? '' : reason,
          [TURN_FACT_START]: String(turn.start.time),
          [TURN_FACT_END]: String(turn.end.time),
        }),
        h('span', {
          key: 'fallback',
          className: `${TURN_CLASS} ${TURN_FALLBACK_CLASS}`,
          title: turnTitle(turn.start.time, turn.end.time),
        }, [
          h('span', { key: 'label', className: `${TURN_CLASS}-label` }, turnLabel(reason, t)),
          h('span', { key: 'value', className: `${TURN_CLASS}-value` }, formatElapsed(elapsed, t)),
        ]),
      ]);
    }

    /**
     * The same figure, painted on the action row's own line.
     *
     * This contribution lives in `conversation.chat.assistant-actions`, the seat
     * DSH hands to the row's `extraActions` — the only way into that row — and
     * `order: 1` in {@link TURN_CSS} is what moves it past the row's own usage
     * figure and clock rather than leaving it in front of the branch button.
     *
     * It paints nothing until it has read the carrier: a Turn that never settled,
     * or a row DSH rendered without its Turn's tail, has no figure to show, and a
     * row that quietly shows none is better than one that shows a guess.
     *
     * @param props - standard seat props; only `t` is needed.
     */
    function TurnElapsed(props) {
      const t = props.t;
      const holder = React.useRef(null);
      const retried = React.useRef(false);
      const [facts, setFacts] = React.useState(undefined);
      // The carrier lands in the same commit as this row, so a layout effect
      // reads it a paint early and the line never flashes in late.
      React.useLayoutEffect(() => {
        const found = readTurnFacts(holder.current);
        setFacts((previous) => (sameTurnFacts(previous, found) ? previous : found));
        // Carrier and row come from two different seats, so a surface that gains
        // one of them a commit later would strand the figure on the fallback
        // line. One deferred re-read covers that, and a read that stays empty
        // changes nothing — the fallback line is already showing.
        if (found !== undefined || retried.current) return;
        retried.current = true;
        requestAnimationFrame(() => {
          setFacts((previous) => {
            const late = readTurnFacts(holder.current);
            return sameTurnFacts(previous, late) ? previous : late;
          });
        });
      });
      if (facts === undefined) {
        // Not hidden by CSS: the class is what the fallback watches for, so an
        // empty first pass must not wear it.
        return h('span', { key: 'anchor', ref: holder, style: { display: 'none' } });
      }
      return h('span', {
        key: 'line',
        ref: holder,
        className: `${TURN_CLASS} ${TURN_INLINE_CLASS}`,
        title: turnTitle(facts.start, facts.end),
      }, [
        h('span', { key: 'label', className: `${TURN_CLASS}-label` }, turnLabel(facts.reason, t)),
        h('span', { key: 'value', className: `${TURN_CLASS}-value` }, formatElapsed(facts.elapsed, t)),
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
        'sessions',
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
        /** The model's own workspace read, before the work-mode projection. */
        let readRawWorkspaces = undefined;
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

        /* ── the work-mode view ───────────────────────────────────────────────── */

        /**
         * Whether one registered workspace is 日常聊天 itself rather than a
         * project.
         *
         * Deliberately stricter than {@link pickDailyWorkspace}, which may fall
         * back to the directory basename alone: a wrong "yes" here deletes a
         * real project from the work-mode sidebar, while a wrong "no" only
         * leaves the daily row in place. The basename fallback therefore also
         * asks for the title the Host half registered the workspace with.
         * @param item - one workspace record.
         * @param expected - the path the Host half registers, when it is known.
         * @returns whether work mode should keep this row out of the sidebar.
         */
        function isDailyWorkspace(item, expected) {
          if (expected !== undefined && item.path === expected) return true;
          const segments = item.path.split(/[\\/]/);
          return segments[segments.length - 1] === DAILY_DIRECTORY && item.title === DAILY_TITLE;
        }

        /** The path the Host half registers the daily workspace under, when it is known. */
        function expectedDailyPath() {
          const home = hostHome();
          return home === undefined ? undefined : home + '/.dsh/' + DAILY_DIRECTORY;
        }

        // A Workspace registration carries no `hidden` flag, so work mode can
        // only keep the daily row out of the sidebar by filtering the snapshot
        // the sidebar renders from. The projection is cached per raw snapshot:
        // the browser reads through `useWorkspaces`, whose selector hook
        // compares snapshots by IDENTITY, and a fresh object on every call would
        // re-render forever.
        /** raw workspace snapshot → its work-mode projection. */
        const workModeViews = new WeakMap();

        /**
         * The workspace snapshot the sidebar may see for the active mode.
         *
         * Chat mode sees everything — that is the mode the daily workspace
         * belongs to, and resolving it reads this very snapshot. Work mode sees
         * every OTHER workspace: 日常聊天 is not a project, and a project row
         * that switches the whole product back into chat mode reads as one.
         * @param snapshot - the model's own snapshot.
         * @returns the snapshot to publish.
         */
        function visibleWorkspaces(snapshot) {
          if (state.mode !== 'work') return snapshot;
          const items = snapshot === null || typeof snapshot !== 'object' ? undefined : snapshot.items;
          if (!Array.isArray(items)) return snapshot;
          const expected = expectedDailyPath();
          if (!items.some((item) => isDailyWorkspace(item, expected))) return snapshot;
          const cached = workModeViews.get(snapshot);
          if (cached !== undefined) return cached;
          const filtered = Object.assign({}, snapshot, {
            items: items.filter((item) => !isDailyWorkspace(item, expected)),
          });
          workModeViews.set(snapshot, filtered);
          return filtered;
        }

        /* ── the work-mode session list ───────────────────────────────────────── */

        /** Shared empty answer for the ordinary "no daily workspace yet" case. */
        const NO_DAILY_IDS = new Set();

        /** raw workspace snapshot → the ids its daily workspace accounts for. */
        const dailyIdViews = new WeakMap();

        /**
         * The session ids the daily workspace accounts for.
         *
         * Read from the model's OWN workspace snapshot, which the projection
         * above deliberately leaves alone: a daily chat is hidden because of
         * what it is, so the question has to be asked of the unfiltered list.
         * @returns the ids, empty while the baseline has not landed yet.
         */
        function dailySessionIds() {
          const snapshot = readRawWorkspaces === undefined ? undefined : readRawWorkspaces();
          const items = snapshot === null || snapshot === undefined ? undefined : snapshot.items;
          if (!Array.isArray(items)) return NO_DAILY_IDS;
          const cached = dailyIdViews.get(snapshot);
          if (cached !== undefined) return cached;
          const expected = expectedDailyPath();
          const ids = new Set();
          for (const item of items) {
            if (!isDailyWorkspace(item, expected)) continue;
            for (const id of item.sessionIds) ids.add(id);
          }
          dailyIdViews.set(snapshot, ids);
          return ids;
        }

        // Hiding the daily WORKSPACE is not enough on its own: the browser
        // builds its 未分组 group out of every Session that no VISIBLE Workspace
        // accounts for, so the daily chats would simply move into that bucket.
        // Work mode therefore drops them from the session list too, which is
        // what "the two modes cannot see each other" means in practice. The
        // projection is cached per raw snapshot for the same identity reason as
        // the workspace one.
        /** raw session-list snapshot → its work-mode projection. */
        const workModeSessionViews = new WeakMap();

        /**
         * Whether one session belongs to the daily workspace.
         * @param id - the session id.
         * @param byId - the raw snapshot's session table.
         * @param accounted - ids the daily workspace accounts for.
         * @param expected - the path the Host half registers, when it is known.
         * @returns whether work mode should keep this session out of the list.
         */
        function isDailySession(id, byId, accounted, expected) {
          if (accounted.has(id)) return true;
          const row = byId[id];
          return row !== undefined && expected !== undefined && row.cwd === expected;
        }

        /**
         * The session-list snapshot the sidebar may see for the active mode.
         *
         * Chat mode sees everything; work mode sees neither the daily workspace
         * nor its chats. Only `ids` is projected — `byId` stays complete, so a
         * session still open in the main column keeps its summary and its
         * status while its row is gone from the list.
         * @param snapshot - the store's own snapshot.
         * @returns the snapshot to publish.
         */
        function visibleSessions(snapshot) {
          if (state.mode !== 'work') return snapshot;
          const ids = snapshot === null || typeof snapshot !== 'object' ? undefined : snapshot.ids;
          const byId = snapshot === null || typeof snapshot !== 'object' ? undefined : snapshot.byId;
          if (!Array.isArray(ids) || byId === null || typeof byId !== 'object') return snapshot;
          const accounted = dailySessionIds();
          const expected = expectedDailyPath();
          const hidden = (id) => isDailySession(id, byId, accounted, expected);
          if (!ids.some(hidden)) return snapshot;
          const cached = workModeSessionViews.get(snapshot);
          if (cached !== undefined) return cached;
          const filtered = Object.assign({}, snapshot, { ids: ids.filter((id) => !hidden(id)) });
          workModeSessionViews.set(snapshot, filtered);
          return filtered;
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

        /* ── pin & archive ────────────────────────────────────────────────── */

        // The workspace browser's own two row actions, over the same model:
        // pinning and archiving go through the Host-global sets, so a chat
        // pinned (or archived) from 日常 is pinned (or archived) for 工作 too.
        // Everything the shipped browser does around the call — the fronted
        // order, the failure notices, the stop-and-archive confirmation, the
        // archived-only filter — is reproduced here, because this list stands
        // in for that browser and must not behave like a second, weaker one.

        /** Bumped per notice, so the toast is remounted only for a new message. */
        let noticeSeq = 0;

        /**
         * Raise one row-action notice.
         *
         * The notice is deliberately shaped the way the workspace browser
         * shapes its own: a sentence the inline actions continue from
         * (「会话已归档，可 [撤销] 或 [筛选已归档会话]」), a success or warning
         * tone, and the shipped six-second hold for successes. {@link
         * RowActionToast} is what paints it, through the shipped `Toast`
         * primitive, so placement and clothes are DSH's rather than ours.
         * @param text - the sentence the actions continue from.
         * @param tone - `success` for a completed action, `warning` for a refusal.
         * @param actions - optional `{ label, prefix, run }` inline buttons.
         */
        function notifyNotice(text, tone, actions) {
          noticeSeq += 1;
          const warning = tone === 'warning';
          setState({
            notice: {
              seq: noticeSeq,
              text,
              tone: warning ? 'warning' : 'success',
              holdMs: warning ? undefined : TOAST_HOLD_MS,
              actions: (Array.isArray(actions) ? actions : []).map((action) => ({
                label: action.label,
                ...(action.prefix === undefined ? {} : { prefix: action.prefix }),
                onClick: () => {
                  dismissNotice();
                  if (typeof action.run === 'function') action.run();
                },
              })),
            },
          });
        }

        /** Take the current notice down. */
        function dismissNotice() {
          if (state.notice !== null) setState({ notice: null });
        }

        /**
         * Switch which archived rows the daily list shows, and remember it.
         * @param filter - one of {@link ARCHIVED_FILTERS}.
         */
        function setArchivedFilter(filter) {
          if (ARCHIVED_FILTERS.indexOf(filter) === -1 || state.archivedFilter === filter) return;
          setState({ archivedFilter: filter });
        }

        /**
         * A session's human title, for the stop-and-archive confirmation.
         * @param sessionId - the session being archived.
         * @returns its display title, or the id when the snapshot has none.
         */
        function dailyTitleOf(sessionId) {
          try {
            const row = ctx.sessions.list.getSnapshot().byId[sessionId];
            if (row !== undefined) {
              if (typeof row.displayTitle === 'string' && row.displayTitle !== '') return row.displayTitle;
              if (typeof row.title === 'string' && row.title !== '') return row.title;
            }
          } catch (reason) {
            console.warn('[daily-chat] reading a daily chat title failed:', reason);
          }
          return sessionId;
        }

        /**
         * The work a Host refusal said is still running, or undefined for any
         * other failure.
         *
         * Error-class identity does not cross client plugin bundles, so — as in
         * the shipped browser — the test is by `name` plus the Remote error
         * code, not by `instanceof`.
         * @param reason - the rejected archive call.
         * @returns the reported activity list, or undefined when this was not
         *   the `workspace/session-active` refusal.
         */
        function activeArchiveActivity(reason) {
          if (reason === null || typeof reason !== 'object') return undefined;
          if (reason instanceof Error && reason.name !== 'WorkspaceArchiveError') return undefined;
          const rpc = reason.rpcError;
          if (rpc === null || typeof rpc !== 'object' || rpc.code !== 'workspace/session-active') return undefined;
          const details = rpc.details;
          const activity = details === null || details === undefined ? undefined : details.activity;
          return Array.isArray(activity) ? activity : [];
        }

        /**
         * The actions a successful archive offers, in the shipped order: undo
         * it, then — after 「或」 — switch the list to the archived filter to
         * find it again. Same wording, same order and same inline placement as
         * the workspace browser's own archive notice, including its one
         * conditional: the filter action is only offered while archived rows
         * are still hidden (offering it from the archived view would be a
         * button that does nothing visible).
         * @param sessionId - the session that was archived.
         * @returns the notice actions, in `notifyNotice`'s shape.
         */
        function archiveNoticeActions(sessionId) {
          const actions = [
            {
              label: t('undo'),
              run: () => unarchiveDaily(sessionId),
            },
          ];
          if (state.archivedFilter === 'default') {
            actions.push({
              label: t('filterArchived'),
              prefix: t('toastOr'),
              run: () => setArchivedFilter('show'),
            });
          }
          return actions;
        }

        /**
         * Archive one daily chat.
         *
         * A chat with work still running is refused by the Host with
         * `workspace/session-active`; that refusal becomes the shipped
         * stop-and-archive confirmation instead of an error, because silently
         * killing a running turn is not a thing an archive button may do.
         * @param sessionId - the session to archive.
         */
        function archiveDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.archiveSession(sessionId))
            .then(() => {
              notifyNotice(t('archivedNotice'), 'success', archiveNoticeActions(sessionId));
            })
            .catch((reason) => {
              const activity = activeArchiveActivity(reason);
              if (activity !== undefined) {
                if (ModalComponent === null) {
                  notifyNotice(t('archiveActiveBlocked'), 'warning');
                  return;
                }
                setState({
                  archiveRequest: {
                    sessionId,
                    displayTitle: dailyTitleOf(sessionId),
                    activity,
                  },
                });
                return;
              }
              console.warn('[daily-chat] archiving a daily chat failed:', reason);
              notifyNotice(t('archiveFailed'), 'warning');
            });
        }

        /**
         * Restore one archived daily chat. Idempotent on the Host, so a lost
         * race with another surface resolves as a no-op.
         * @param sessionId - the session to unarchive.
         */
        function unarchiveDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.unarchiveSession(sessionId))
            .catch((reason) => {
              console.warn('[daily-chat] unarchiving a daily chat failed:', reason);
              notifyNotice(t('unarchiveFailed'), 'warning');
            });
        }

        /**
         * Pin one daily chat to the front of the list. The shipped service also
         * fronts it in the browser's saved manual order, so 工作's manual view
         * agrees with this one.
         * @param sessionId - the session to pin.
         */
        function pinDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.pinSession(sessionId))
            .catch((reason) => {
              console.warn('[daily-chat] pinning a daily chat failed:', reason);
              notifyNotice(t('pinFailed'), 'warning');
            });
        }

        /**
         * Drop one daily chat's pin.
         * @param sessionId - the session to unpin.
         */
        function unpinDaily(sessionId) {
          Promise.resolve()
            .then(() => ctx.uiWorkspace.unpinSession(sessionId))
            .catch((reason) => {
              console.warn('[daily-chat] unpinning a daily chat failed:', reason);
              notifyNotice(t('unpinFailed'), 'warning');
            });
        }

        /**
         * The confirmation's `停止并归档`: stop what the Host listed, then
         * archive. Errors stay in the dialog so it can be retried or cancelled.
         * @param sessionId - the session to stop and archive.
         */
        async function stopAndArchiveDaily(sessionId) {
          await ctx.uiWorkspace.archiveSession(sessionId, { stopActivity: true });
          setState({ archiveRequest: null });
          notifyNotice(t('stoppedArchivedNotice'), 'success', archiveNoticeActions(sessionId));
        }

        /**
         * One line of the confirmation's activity list, in the shipped wording.
         * @param entry - one `{ kind, items }` activity record from the Host.
         * @returns the localized line.
         */
        function archiveActivityLine(entry) {
          if (entry === null || typeof entry !== 'object') return '';
          const items = Array.isArray(entry.items) ? entry.items : [];
          const names = items
            .map((item) => (item === null || typeof item !== 'object' ? '' : String(item.label ?? item.id ?? '')))
            .join(t('archiveConfirmListSeparator'));
          const n = items.length;
          switch (entry.kind) {
            case 'turn': return t('archiveConfirmTurn');
            case 'subagent': return t('archiveConfirmSubagents', { n, names });
            case 'job': return t('archiveConfirmJobs', { n, names });
            case 'schedule': return t('archiveConfirmSchedules', { n, names });
            default: return t('archiveConfirmOther', { n, kind: String(entry.kind ?? '') });
          }
        }

        /**
         * The Host code a failed create carried, when it carried one.
         *
         * The client hands a create failure over as a `SessionCreateError` whose
         * own `rpcError` holds the Host's code, so the code is the difference
         * between "this deployment has no `daily` preset" and every other
         * failure.
         * @param reason - the thrown create failure.
         * @returns the code, or undefined.
         */
        function hostErrorCode(reason) {
          if (reason === null || typeof reason !== 'object') return undefined;
          if (typeof reason.code === 'string') return reason.code;
          const rpc = reason.rpcError;
          if (rpc === null || typeof rpc !== 'object' || typeof rpc.code !== 'string') return undefined;
          return rpc.code;
        }

        /**
         * Whether the daily workspace already holds the blank Session a create
         * would reuse.
         *
         * Answered from a FRESH snapshot, with the predicate DSH's own
         * `createInWorkspace` picks its blank with, because that fact decides
         * whether the fallback below may run: a blank means the create will
         * compose a Session that already exists, and no blank means it mints a
         * new one. Re-resolving the workspace here rather than reading the item
         * `resolveDailyWorkspace` handed over keeps both reads on one snapshot
         * version — the create re-resolves its workspace too.
         *
         * Anything it cannot read counts as "there is something to reuse": the
         * caller's conservative answer is to keep the original failure.
         * @param workspaceId - the daily workspace's id.
         * @returns whether a reuse is possible.
         */
        function hasReusableBlank(workspaceId) {
          try {
            const registry = ctx.workspaces.list.getSnapshot();
            const items = registry === null || registry === undefined ? undefined : registry.items;
            if (!Array.isArray(items)) return true;
            const workspace = items.find((item) => item.workspaceId === workspaceId);
            if (workspace === undefined) return false;
            const sessions = ctx.sessions.list.getSnapshot();
            const byId = sessions === null || sessions === undefined ? undefined : sessions.byId;
            const ids = sessions === null || sessions === undefined ? undefined : sessions.ids;
            if (byId === null || typeof byId !== 'object' || !Array.isArray(ids)) return true;
            const archived = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : [];
            return ids.some((id) => {
              const row = byId[id];
              return row !== undefined
                && row.blank
                && row.cwd === workspace.path
                && workspace.sessionIds.indexOf(id) !== -1
                && archived.indexOf(id) === -1;
            });
          } catch (reason) {
            console.warn('[daily-chat] reading the workspace for a reusable blank Session failed:', reason);
            return true;
          }
        }

        /**
         * Open the daily workspace's blank Session, asking for the daily preset
         * as part of the request instead of composing it afterwards.
         *
         * `connectWorkspace` opens the blank Session a workspace already has —
         * its second argument is what puts it in that reuse branch at all — and
         * DSH composes a reused or minted blank with the preset the create
         * request NAMES, falling back to the deployment default when it names
         * none. That default is what a daily chat may not run on (see the Host
         * half's preset lock), so the unnamed request is refused and the whole
         * create fails with `failed to create session: … 日常聊天固定使用 daily
         * 预设…`. Clicking 「日常聊天」 a second time is exactly that request: the
         * first click already put the blank on `daily`, so the second one asked
         * to put it back on the default. Naming `daily` makes the request agree
         * with the Session it reuses, and a workspace with no blank mints the new
         * Session on `daily` directly rather than composing it on the default and
         * switching afterwards.
         *
         * The fallback keeps the degradation this plugin documents elsewhere — a
         * deployment whose roster lost `daily` still opens the chat on its default
         * preset, with a warning — and it retries ONLY when both halves of that
         * case hold: the create failed because the preset could not be resolved
         * (every other failure is reported instead of retried, which also keeps a
         * half-finished create from being run twice), and the workspace has
         * nothing to reuse. The reuse branch is precisely the one that cannot
         * reach the default: it composes the Session it reuses, the Host lock
         * refuses every non-daily preset for a Session in the daily directory,
         * and retrying through it would hand the user back the very error this
         * function exists to avoid.
         * @param workspace - the resolved daily workspace.
         * @returns the Session the workspace opened.
         */
        async function connectDailySession(workspace) {
          try {
            return await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId, { agentPreset: DAILY_PRESET });
          } catch (reason) {
            const code = hostErrorCode(reason);
            const missingPreset = code === 'agent-preset/not-found' || code === 'agent-preset/invalid';
            if (!missingPreset || hasReusableBlank(workspace.workspaceId)) throw reason;
            console.warn(`[daily-chat] the "${DAILY_PRESET}" preset is unavailable; opening on the deployment default instead:`, reason);
            return await ctx.uiWorkspace.connectWorkspace(workspace.workspaceId);
          }
        }

        /**
         * Start (or reuse the blank) daily session and compose it on the daily
         * preset.
         *
         * Resolving the workspace is asynchronous, and the two mode rows are one
         * click apart: without the ticket below, picking 「开始工作」 while a
         * daily start is still in flight would let that start land afterwards
         * and drag the UI back into chat mode. A start that loses the ticket
         * also leaves the mode alone — the newer action already set it.
         *
         * Chat mode is published BEFORE the workspace is resolved, because work
         * mode hides the daily workspace from the snapshot (see
         * {@link visibleWorkspaces}) and both the resolution and the connect
         * below read that snapshot. A start that fails puts the previous mode
         * back and hands the centre column back with it, so a refusal leaves the
         * sidebar and the composer exactly as they were instead of parking the
         * middle column on the placeholder line a transient panel paints.
         */
        async function startDailyChat() {
          if (starting) return;
          starting = true;
          const ticket = ++startTicket;
          const previous = state.mode;
          setState({ mode: 'daily', busy: true, error: null });
          try {
            const workspace = await resolveDailyWorkspace();
            if (ticket !== startTicket) return;
            const sessionId = await connectDailySession(workspace);
            if (ticket !== startTicket) return;
            setState({ busy: false, error: null });
            ctx.layout.selectPanel(null);
            ctx.uiWorkspace.openSession(sessionId);
            try {
              await ctx.remote.agentPresets.select(sessionId, DAILY_PRESET);
            } catch (reason) {
              console.warn(`[daily-chat] composing the "${DAILY_PRESET}" preset failed:`, reason);
            }
          } catch (reason) {
            console.warn('[daily-chat] starting a daily chat failed:', reason);
            if (ticket !== startTicket) return;
            setState({ mode: previous, busy: false, error: `${t('failed')}：${describe(reason)}` });
            ctx.layout.selectPanel(null);
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
         * Conversations accounted to the daily workspace, in the workspace
         * browser's own order and under its own archived filter.
         *
         * Pinned rows lead — newest first among themselves — and everything
         * else follows newest first, exactly what the shipped browser does in
         * its default 「最近更新」 order: `sectionMembers` fronts the pinned
         * partition without touching either side's order. Archival follows the
         * filter: hidden by default, mixed in for `show`, alone for `only`.
         * Blank and subagent rows stay out in every case, as before.
         *
         * @param workspaces - the workspace snapshot.
         * @param sessions - the session-list snapshot.
         * @param archivedFilter - one of {@link ARCHIVED_FILTERS}.
         * @returns the rows both daily surfaces render.
         */
        function dailyRows(workspaces, sessions, archivedFilter) {
          const workspace = pickDailyWorkspace(workspaces.items);
          if (workspace === undefined || sessions.phase !== 'ready') return [];
          const archivedIds = Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : [];
          const pinnedIds = Array.isArray(workspaces.pinnedSessionIds) ? workspaces.pinnedSessionIds : [];
          const archived = new Set(archivedIds);
          const pinned = new Set(pinnedIds);
          const filter = ARCHIVED_FILTERS.indexOf(archivedFilter) === -1 ? 'default' : archivedFilter;
          const rows = [];
          for (const id of workspace.sessionIds) {
            const row = sessions.byId[id];
            if (row === undefined || row.blank === true || row.origin === 'subagent') continue;
            const isArchived = archived.has(id);
            if (filter === 'default' && isArchived) continue;
            if (filter === 'only' && !isArchived) continue;
            // A pinned row can never be archived (the Host refuses that pin),
            // so the two markers are mutually exclusive on screen as well.
            rows.push(Object.assign({}, row, {
              archived: isArchived,
              pinned: !isArchived && pinned.has(id),
            }));
          }
          rows.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
          // Stable partition, not a second sort: pinned rows keep their recency
          // order among themselves, and so does the rest.
          const leading = rows.filter((row) => row.pinned);
          const rest = rows.filter((row) => !row.pinned);
          return leading.concat(rest);
        }

        /**
         * The session the centre column currently shows, for the selected-row
         * highlight. Read from the Session list exactly the way the workspace
         * browser reads it: the entry retained by the main view.
         * @param sessions - the session-list snapshot.
         * @returns the session id, or undefined when nothing is open.
         */
        function currentDailySessionId(sessions) {
          try {
            for (const id of sessions.ids) {
              const row = sessions.byId[id];
              if (row === undefined) continue;
              const retainedBy = row.retainedBy;
              if (retainedBy !== undefined && retainedBy !== null && retainedBy.mainView > 0) return id;
            }
          } catch (reason) {
            console.warn('[daily-chat] reading the open daily chat failed:', reason);
          }
          return undefined;
        }

        /**
         * How many rows one page adds to the daily list.
         *
         * The rows are all in the snapshot already — this window decides what
         * gets painted, not what gets fetched. An account with hundreds of
         * conversations therefore mounts one page of buttons on open and one
         * more page each time the list reaches its end, instead of mounting
         * every row before the first paint.
         */
        const ROW_PAGE = 20;

        /**
         * The sliding window of daily rows the mounted list has painted.
         *
         * The window belongs to the list, not to the snapshot: a row arriving,
         * leaving or being renamed re-cuts the same window and must never push
         * rows below it back out of reach. Entering 日常 remounts the region, so
         * the window starts over at one page there.
         *
         * The end of the list is a 1px `.dsc-pager` strip watched by an
         * IntersectionObserver rooted at the scroll container. That is one
         * browser-maintained comparison instead of a scroll handler, and it also
         * covers a viewport tall enough to show the whole page: the strip is in
         * view on mount, so the next page loads even though no wheel event can
         * ever reach the bottom of a list that does not overflow yet.
         *
         * The effect re-arms after every page (`visible` is a dependency)
         * because a viewport may be tall enough to show two or three pages: an
         * observer kept on the same node only fires on threshold CROSSINGS, so
         * once the strip stays inside the viewport it would never ask again.
         * Re-observing publishes the current state instead, and the window keeps
         * growing until the list overflows or runs out — never leaving a
         * non-scrollable list with rows stranded behind it.
         *
         * @param rows - the rows the list would paint without a window.
         * @returns `visible` (rows to paint), `more` (whether any wait behind
         *   them), `listRef` (the scroll container) and `sentinelRef` (the
         *   trigger strip).
         */
        function usePagedRows(rows) {
          const [visible, setVisible] = React.useState(ROW_PAGE);
          const listRef = React.useRef(null);
          const sentinelRef = React.useRef(null);
          const total = rows.length;
          const more = total > visible;

          React.useEffect(() => {
            if (!more) return undefined;
            const scroll = listRef.current;
            const sentinel = sentinelRef.current;
            if (scroll === null || sentinel === null) return undefined;
            if (typeof IntersectionObserver !== 'function') {
              // No observer (an old webview): paint everything. A window that
              // can never grow would hide rows with nothing left to reveal them.
              setVisible(total);
              return undefined;
            }
            const observer = new IntersectionObserver((entries) => {
              if (!entries.some((entry) => entry.isIntersecting)) return;
              setVisible((painted) => Math.min(painted + ROW_PAGE, total));
            }, { root: scroll, rootMargin: '120px 0px' });
            observer.observe(sentinel);
            return () => { observer.disconnect(); };
          }, [more, total, visible]);

          return { visible, more, listRef, sentinelRef };
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

        /* ── the shell's own rows, moved into the 「更多」 expansion ─────────────── */

        /**
         * One ledger read of the sidebar's panel rows. The raw entry list is
         * stable between mutations, which is what makes it a legal
         * `useSyncExternalStore` snapshot; the label thunks on it follow the
         * active locale.
         */
        const readPanelEntries = () => ctx.slots.entries('sidebar.panellist');
        /** Panel-ledger notifications (the shell repaints rows off the same slot). */
        const subscribePanelEntries = (listener) => ctx.slots.subscribe('sidebar.panellist', listener);

        /** The panel-list ledger as React sees it: rows this plugin does not own. */
        function usePanelEntries() {
          return React.useSyncExternalStore(subscribePanelEntries, readPanelEntries, readPanelEntries);
        }

        /**
         * Resolve one ledger row's label. `options.label` is either text or a
         * thunk that follows the active locale; the shell projects rows through
         * the same thunk, so the moved menu rows speak exactly what the rows
         * they replace said.
         * @param entry - one `sidebar.panellist` ledger entry, when present.
         * @returns the row's display text, or undefined when it has none.
         */
        function entryLabel(entry) {
          if (entry === undefined) return undefined;
          const label = entry.options.label;
          const text = typeof label === 'function' ? label() : label;
          return typeof text === 'string' && text !== '' ? text : undefined;
        }

        /** The ledger entry behind one moved row, or undefined while it is absent. */
        function movedEntry(entries, id) {
          return entries.find((entry) => entry.options.id === id);
        }

        /**
         * Resolve one ledger row's glyph. A `sidebar.panellist` entry's component
         * IS the icon the shell paints beside the row's label, so the moved menu
         * rows borrow it rather than inventing one — 「插件」 keeps its pinwheel and
         * 「自动化任务」 its clock, in the same 16px cell as the menu's own icons.
         * @param entry - one ledger entry, when present.
         * @returns the leading icon for a menu row, or undefined when it has none.
         */
        function entryGlyph(entry) {
          if (entry === undefined || typeof entry.component !== 'function') return undefined;
          return h(entry.component, { size: 16 });
        }

        /**
         * The two menu rows that stand in for the moved panel rows: 「插件」 and
         * 「自动化任务」. Label and glyph both come from the shell's ledger, so the
         * rows look like the rows they replace. They call the owner's own
         * `onOpen` — the entry point the shell's menu rows use, which selects the
         * panel and reports the click — after dismissing the menu. This component
         * is the fallback path: it renders only when the menu stays the shell's
         * own (see {@link ownsMoreMenu}), because the expansion paints its rows
         * itself.
         * @param props - owner seats (`onOpen`, `onDismiss`) supplied by the menu.
         * @returns two menu rows, or null while neither panel is registered.
         */
        function MovedPanelsMenu(props) {
          const entries = usePanelEntries();
          if (MenuItemButton === null) return null;
          const rows = [];
          for (const id of MOVED_PANEL_IDS) {
            const entry = movedEntry(entries, id);
            const label = entryLabel(entry);
            if (label === undefined) continue;
            rows.push(h(MenuItemButton, {
              key: id,
              icon: entryGlyph(entry),
              onSelect: () => {
                props.onDismiss();
                props.onOpen(id);
              },
            }, label));
          }
          return rows.length === 0 ? null : h(React.Fragment, null, rows);
        }

        /**
         * Hide the two moved rows from the panel list.
         *
         * A row's only DOM handles are its hashed class, its localized
         * `aria-label` and `aria-current` — no id, no `data-*` — so the rule is
         * matched on the label the ledger reports: the same text the row paints,
         * whatever locale is active. It is published only while the 「更多」
         * expansion can actually carry the two rows; with no expansion to move
         * them into (an
         * older DSH without the actions seat, a primitives build without
         * `MenuItemButton`) every row stays visible instead of disappearing off
         * the sidebar.
         * @returns the label-matched rules, or null while hiding is not safe.
         */
        function MovedPanelsStyle() {
          const ready = useChatState().moreMenuReady;
          const entries = usePanelEntries();
          if (!ready || MenuItemButton === null) return null;
          const rules = [];
          for (const id of MOVED_PANEL_IDS) {
            const label = entryLabel(movedEntry(entries, id));
            if (label === undefined) continue;
            const quoted = JSON.stringify(label);
            rules.push(`nav[class*="panelList"] button[aria-label=${quoted}]{display:none !important}`);
          }
          return rules.length === 0 ? null : h('style', null, rules.join(''));
        }

        /* ── 「更多」 as an inline expansion ───────────────────────────────────── */

        /** The panel list, or null before the shell paints it. */
        function panelList() {
          return document.querySelector('nav[class*="panelList"]');
        }

        /**
         * The 「更多」 row itself: the only menu launcher in the panel list. A
         * shell that renames the list or the row yields null, and every pass
         * below then stays out of the way.
         * @param list - the panel list, when already resolved.
         * @returns the trigger button, or null.
         */
        function moreTrigger(list) {
          if (list === null) return null;
          return list.querySelector('button[aria-haspopup="menu"]');
        }

        /**
         * Whether the expansion may carry the menu seat.
         *
         * The seat's own rows are this plugin's two moved panel rows plus, on a
         * stock install, `entry-customization`'s two discovery rows — both
         * reproduced by hand below. Any OTHER row belongs to a plugin whose
         * component this pass cannot render outside the shell's menu, so one
         * unknown row is enough to leave that menu to the shell: the failure
         * direction is the shipped native menu, never a hidden row.
         * @param entries - the `sidebar.panellist.actions` ledger.
         * @returns whether the expansion owns that menu.
         */
        function ownsMoreMenu(entries) {
          return entries.every((entry) => {
            const id = entry.options.id;
            return id === MOVED_ACTIONS_ID || id === ENTRY_CUSTOMIZATION_ID;
          });
        }

        /** Snapshot handed out while the menu seat cannot be read at all. */
        const EMPTY_ACTIONS = [];

        /** One ledger read of the menu seat; a missing seat reads as empty. */
        const readActionsEntries = () => {
          try {
            return ctx.slots.entries('sidebar.panellist.actions');
          } catch (reason) {
            console.warn('[daily-chat] reading the menu seat failed:', reason);
            return EMPTY_ACTIONS;
          }
        };
        /** Menu-seat notifications, silent on a build without that seat. */
        const subscribeActionsEntries = (listener) => {
          try {
            return ctx.slots.subscribe('sidebar.panellist.actions', listener);
          } catch (reason) {
            console.warn('[daily-chat] watching the menu seat failed:', reason);
            return () => {};
          }
        };

        /** The menu seat's ledger as React sees it. */
        function useActionsEntries() {
          return React.useSyncExternalStore(subscribeActionsEntries, readActionsEntries, readActionsEntries);
        }

        /**
         * Take the 「更多」 row's click before the shell's menu can answer it.
         *
         * The row's click handler is the shell's and toggles ITS menu — the one
         * that closes on `Esc`, on an outside click and after any row. The
         * expansion is the plugin's own open state, so the click is claimed in
         * the capture phase: the event never reaches the shell's handler, no
         * menu mounts, and the same row closes the expansion again while it
         * reads 「收起」. The rail keeps the native menu — an icon column has no
         * width for the rows.
         * @param onToggle - called instead of the shell's menu.
         * @returns the disposer that gives the row back.
         */
        function mountMoreTrigger(onToggle) {
          if (typeof document === 'undefined') return () => {};
          const onClick = (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const row = target.closest('button[aria-haspopup="menu"]');
            if (row === null) return;
            const list = panelList();
            if (list === null || !list.contains(row)) return;
            if (list.getBoundingClientRect().width < MORE_MIN_WIDTH) return;
            event.preventDefault();
            event.stopPropagation();
            onToggle();
          };
          document.addEventListener('click', onClick, true);
          return () => document.removeEventListener('click', onClick, true);
        }

        /**
         * Park the expansion under the 「更多」 row and reserve its height in the
         * panel list, exactly where the rows would sit if the list had painted
         * them: the surface is fixed at the list's own left edge and width, and
         * the list's bottom padding grows by the surface's height so the
         * sessions below move down with it.
         *
         * The trigger row is marked while it is open — the open-state paint, the
         * `aria-expanded` a screen reader reads, and the label carrier that
         * paints 「收起」. All of it is re-asserted every frame because the shell
         * repaints the row on its own schedule; closing removes it again. A row
         * that disappears (the sidebar collapsed to its rail, the sidebar
         * unmounted) closes the expansion rather than stranding it.
         * @param surface - the expansion surface, already mounted.
         * @param collapseLabel - the trigger's open-state text.
         * @param onLost - called when the row, or the width the rows need, is gone.
         * @returns the disposer that removes every mark and the reserved height.
         */
        function mountMoreGeometry(surface, collapseLabel, onLost) {
          if (
            typeof document === 'undefined'
            || surface === null
            || typeof requestAnimationFrame !== 'function'
          ) {
            return () => {};
          }

          /** Handle of the geometry loop, or 0 while it is not running. */
          let frame = 0;
          /** The list whose bottom padding holds the reserved height. */
          let spacedList = null;
          /** The trigger row this pass has marked. */
          let markedRow = null;
          /** The trigger's title span, while the open-state label is painted. */
          let markedTitle = null;

          /** Drop every mark the current pass holds. */
          function unmark() {
            if (markedTitle !== null) {
              markedTitle.removeAttribute(MORE_OPEN_ATTR);
              markedTitle = null;
            }
            if (markedRow !== null) {
              markedRow.removeAttribute(MORE_OPEN_ROW_ATTR);
              markedRow.setAttribute('aria-expanded', 'false');
              markedRow = null;
            }
            if (spacedList !== null) {
              spacedList.style.paddingBottom = '';
              spacedList = null;
            }
          }

          /** Stop the loop and give the row and the list their space back. */
          function release() {
            if (frame !== 0) {
              cancelAnimationFrame(frame);
              frame = 0;
            }
            unmark();
          }

          /** One frame: re-measure, re-mark, then ask for the next one. */
          function measure() {
            frame = 0;
            const list = panelList();
            const row = moreTrigger(list);
            if (
              list === null
              || row === null
              || !surface.isConnected
              || list.getBoundingClientRect().width < MORE_MIN_WIDTH
            ) {
              release();
              onLost();
              return;
            }
            if (markedRow !== row) {
              if (markedRow !== null) {
                markedRow.removeAttribute(MORE_OPEN_ROW_ATTR);
                markedRow.setAttribute('aria-expanded', 'false');
              }
              markedRow = row;
            }
            if (!row.hasAttribute(MORE_OPEN_ROW_ATTR)) row.setAttribute(MORE_OPEN_ROW_ATTR, '');
            if (row.getAttribute('aria-expanded') !== 'true') row.setAttribute('aria-expanded', 'true');
            // The title span is the 「收起」 carrier; the rail paints no title at
            // all, and that state never reaches this pass.
            const title = row.querySelector('span[class*="panelTitle"]');
            if (title === null) {
              if (markedTitle !== null) {
                markedTitle.removeAttribute(MORE_OPEN_ATTR);
                markedTitle = null;
              }
            } else {
              if (markedTitle !== title && markedTitle !== null) markedTitle.removeAttribute(MORE_OPEN_ATTR);
              markedTitle = title;
              if (!title.hasAttribute(MORE_OPEN_ATTR)) title.setAttribute(MORE_OPEN_ATTR, collapseLabel);
            }
            const listRect = list.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            surface.style.left = `${listRect.left + 2}px`;
            surface.style.top = `${rowRect.bottom + 2}px`;
            surface.style.width = `${Math.max(0, listRect.width - 4)}px`;
            const height = surface.getBoundingClientRect().height;
            if (height > 0) {
              // A repainted list is a new node even at the same height, and a
              // reservation wiped by someone else has to come back; comparing
              // the inline value every frame covers both.
              if (spacedList !== null && spacedList !== list) spacedList.style.paddingBottom = '';
              const reserved = `${height}px`;
              if (list.style.paddingBottom !== reserved) list.style.paddingBottom = reserved;
              spacedList = list;
            }
            frame = requestAnimationFrame(measure);
          }

          measure();
          return release;
        }

        /** Select one of the moved rows' panels, leaving the expansion open. */
        function openPanel(id) {
          try {
            ctx.layout.selectPanel(id);
          } catch (reason) {
            console.warn('[daily-chat] opening the panel failed:', reason);
          }
        }

        /**
         * One borrowed glyph as a 16px element. Passed the component — not an
         * element — a plain `h(child)` renders nothing, which is how the two
         * discovery rows first lost their icons.
         * @param component - the glyph component, or null when this build lacks it.
         * @returns the 16px glyph element, or null.
         */
        function glyphOf(component) {
          return component === null ? null : h(component, { size: 16 });
        }

        /** One row of the expansion: glyph, label, and what a click does. */
        function expansionRow(key, glyph, label, onSelect) {
          return h('button', {
            key,
            type: 'button',
            className: 'dsc-more-row',
            onClick: onSelect,
          }, [
            h('span', { key: 'glyph', className: 'dsc-more-glyph', 'aria-hidden': 'true' }, glyph),
            h('span', { key: 'label', className: 'dsc-more-title' }, label),
          ]);
        }

        /**
         * The two discovery rows the shell's menu carries after this plugin's
         * own: 「浏览更多插件」 and 「创建你的插件」.
         *
         * They belong to the shipped `entry-customization` plugin, which offers
         * no seat-level API a bundle can delegate to once that menu is out of
         * the picture, so the rows are reproduced from the copy the plugin
         * publishes and the two calls it makes — `pluginNavigation.openList()`
         * and a creator session, called the way that plugin calls them. Either may
         * be missing on a given build; the row is then left out rather than shown
         * broken.
         * @param present - whether that plugin registered into the menu seat at all.
         * @returns the discovery rows, in the menu's own order.
         */
        function discoveryRows(present) {
          const rows = [];
          if (!present) return rows;
          const custom = ctx.locale.bind('entryCustomization');
          const install = custom('install');
          const create = custom('create');
          // A build without that locale namespace resolves the key itself;
          // `install`/`create` standing in for the sentence means these rows are
          // not this plugin's to reproduce.
          if (install === 'install' || create === 'create') return rows;
          const navigation = ctx.get('pluginNavigation');
          if (navigation !== undefined && typeof navigation.openList === 'function') {
            rows.push(expansionRow('browse-plugins', glyphOf(DiscoveryBrowseGlyph), install, () => {
              try {
                navigation.openList();
              } catch (reason) {
                console.warn('[daily-chat] opening the plugin list failed:', reason);
              }
            }));
          }
          if (typeof ctx.uiWorkspace.startSession === 'function') {
            const prompt = custom('createPrompt.sidebar');
            rows.push(expansionRow('create-plugin', glyphOf(DiscoveryCreateGlyph), create, () => {
              try {
                ctx.uiWorkspace.startSession(undefined, {
                  agentPreset: CREATOR_PRESET,
                  prompt: prompt === 'createPrompt.sidebar' ? undefined : prompt,
                  whenDraftExists: 'append',
                });
              } catch (reason) {
                console.warn('[daily-chat] starting the creator chat failed:', reason);
              }
            }));
          }
          return rows;
        }

        /**
         * Move focus into the expansion the way the shell's menu did, and walk
         * its rows with Up/Down.
         *
         * Focus stays inside the expansion while it is open, so the open state
         * never fights the page's own focus: opening lands on the first row,
         * Up/Down walk the rows, and Up from the first row returns to the
         * trigger row — which reads 「收起」 and closes on Enter. `Esc` is left
         * alone on purpose; it is not a way out of this expansion.
         * @param surface - the expansion surface, already mounted.
         * @returns the disposer that stops the keyboard walk.
         */
        function mountMoreFocus(surface) {
          if (surface === null || typeof document === 'undefined') return () => {};
          const rowsIn = () => Array.from(surface.querySelectorAll('button:not(:disabled)'));
          const first = rowsIn()[0];
          if (first !== undefined) first.focus({ preventScroll: true });
          const onKeyDown = (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const rows = rowsIn();
            if (rows.length === 0) return;
            const index = rows.indexOf(document.activeElement);
            if (index === -1) return;
            event.preventDefault();
            if (event.key === 'ArrowDown') {
              rows[(index + 1) % rows.length].focus();
              return;
            }
            if (index > 0) {
              rows[index - 1].focus();
              return;
            }
            const trigger = moreTrigger(panelList());
            if (trigger !== null) trigger.focus();
          };
          surface.addEventListener('keydown', onKeyDown);
          return () => {
            surface.removeEventListener('keydown', onKeyDown);
          };
        }

        /**
         * The 「更多」 expansion: the panel rows the shell's own menu used to
         * carry, painted as a continuation of the panel list.
         *
         * It replaces that menu rather than decorating it. The menu closes on
         * `Esc`, on a click outside itself and after any row is chosen — and
         * those three are exactly what the expansion must not do, so the open
         * state has to be the plugin's: opened by the 「更多」 row, closed by the
         * same row while it reads 「收起」, and by nothing else except the row
         * leaving the sidebar. Clicks inside are ordinary row clicks: they open
         * their panel (or the plugin list / a creator chat) and the expansion
         * stays put.
         *
         * The surface portals to `<body>`: the frame's overlay layer paints
         * below the sidebar column, so a fixed box inside it would sit behind
         * the sidebar. A slot component still owns it, and the geometry pass
         * follows the trigger row every frame.
         */
        function MoreExpansion(props) {
          const chat = useChatState();
          const entries = usePanelEntries();
          const actionEntries = useActionsEntries();
          const t = typeof props.t === 'function' ? props.t : (key) => key;
          const collapseLabel = t('moreCollapse');
          const owned = chat.moreMenuReady
            && MenuItemButton !== null
            && createPortal !== null
            && ownsMoreMenu(actionEntries);
          const expanded = owned && chat.moreExpanded;
          const surface = React.useRef(null);

          // The trigger row's click is claimed only while this pass can carry
          // its menu; otherwise the shell's menu stays exactly as it shipped.
          React.useEffect(() => {
            if (!owned) return undefined;
            return mountMoreTrigger(() => {
              setState({ moreExpanded: !state.moreExpanded });
            });
          }, [owned]);

          // Follow the row for as long as the surface is open. A layout effect,
          // so the first frame is measured and placed before anything paints.
          React.useLayoutEffect(() => {
            if (!expanded) return undefined;
            return mountMoreGeometry(surface.current, collapseLabel, () => {
              setState({ moreExpanded: false });
            });
          }, [expanded, collapseLabel]);

          // The shell's own menu walked its rows with the keyboard (it focused
          // the first one); the expansion keeps that part: focus lands on the
          // first row, Up/Down walk the rows, and Up from the first row goes
          // back to the trigger, whose Enter closes the expansion.
          React.useLayoutEffect(() => {
            if (!expanded) return undefined;
            return mountMoreFocus(surface.current);
          }, [expanded]);

          // A menu seat this pass cannot carry (an unknown third-party row, the
          // seat going away) hands the whole interaction back to the shell.
          React.useEffect(() => {
            if (owned || !chat.moreExpanded) return;
            setState({ moreExpanded: false });
          }, [owned, chat.moreExpanded]);

          if (!expanded) return null;
          const rows = [];
          for (const id of MOVED_PANEL_IDS) {
            const entry = movedEntry(entries, id);
            const label = entryLabel(entry);
            if (label === undefined) continue;
            rows.push(expansionRow(id, entryGlyph(entry), label, () => openPanel(id)));
          }
          rows.push(...discoveryRows(actionEntries.some((entry) => entry.options.id === ENTRY_CUSTOMIZATION_ID)));
          if (rows.length === 0) return null;
          return createPortal(h('div', {
            className: 'dsc-more',
            ref: surface,
            role: 'group',
            'aria-label': t('moreGroup'),
          }, rows), document.body);
        }

        /* ── the conversation view row's menu ─────────────────────────────────── */

        /**
         * Keep the conversation view tab row's 「更多」 menu free of the two
         * plugin-discovery actions.
         *
         * That menu belongs to the conversation shell; the rows come from the
         * shipped `entry-customization` plugin (`浏览更多插件` / `创建你的插件`),
         * which has no seat-level switch a bundle can flip. They are recognised
         * by the labels that plugin publishes in its own locale namespace —
         * `ctx.locale.bind('entryCustomization')` resolves them in whatever
         * language is active, and a namespace this build no longer carries makes
         * `translate` fall back to the key itself, so nothing matches and the
         * rows simply stay. The menu surface is recognised by the
         * `viewsMoreMenu` class half it carries (`viewsMoreMenu` is the
         * listClassName the conversation shell passes to the shared menu), which
         * is why the sidebar's own 「更多」 is never touched.
         *
         * The launcher's own visibility is decided up front by
         * {@link ViewMoreWatch}; this pass only needs a fallback for the case
         * that estimate misses (a view the shell hides for its own reasons): if
         * the menu turns out to hold nothing but those two rows, the surface is
         * marked hidden and the launcher toggled closed within the same mutation
         * turn — before a paint — and stays hidden until the tab strip moves.
         *
         * @returns the disposer that gives the menu and its launcher back.
         */
        function mountViewActions() {
          if (
            typeof document === 'undefined'
            || typeof MutationObserver !== 'function'
          ) {
            return () => {};
          }

          const entryT = ctx.locale.bind('entryCustomization');
          /** Disposer of the one-shot tab-strip watcher, while a launcher is hidden. */
          let releaseTabs = null;

          /** The two row labels to remove, in the active language. */
          function hiddenLabels() {
            return new Set([entryT('install'), entryT('create')]);
          }

          /** Stop watching the tab strip and show every hidden launcher again. */
          function restoreLaunchers() {
            if (releaseTabs !== null) releaseTabs();
            for (const marked of document.querySelectorAll(`[${VIEW_MORE_EMPTY_ATTR}]`)) {
              marked.removeAttribute(VIEW_MORE_EMPTY_ATTR);
            }
          }

          /** Bring the launcher back on the next tab-strip change. */
          function watchTabs(trigger) {
            restoreLaunchers();
            const anchor = trigger.closest(`[class*="${VIEW_MORE_ANCHOR_CLASS}"]`);
            const row = anchor === null ? null : anchor.parentElement;
            const tabs = row === null ? null : row.querySelector(`[${CONVERSATION_TABS_ATTR}]`);
            if (tabs === null) return;
            const watcher = new MutationObserver(() => {
              restoreLaunchers();
            });
            const dispose = () => {
              watcher.disconnect();
              if (releaseTabs === dispose) releaseTabs = null;
            };
            watcher.observe(tabs, { childList: true });
            releaseTabs = dispose;
          }

          /** Remove the two rows; retire the launcher when nothing else is left. */
          function filter(surface) {
            const labels = hiddenLabels();
            let removed = 0;
            for (const row of surface.querySelectorAll('button[role="menuitem"]')) {
              const text = (row.textContent ?? '').trim();
              if (!labels.has(text)) continue;
              row.setAttribute(VIEW_ACTION_ATTR, '');
              removed += 1;
            }
            if (removed === 0) return;
            const left = surface.querySelectorAll(`button[role="menuitem"]:not([${VIEW_ACTION_ATTR}])`);
            if (left.length > 0) return;
            // Nothing but the plugin actions: close the empty surface before it
            // can paint and keep the launcher out of the way until the tab strip
            // moves again.
            surface.setAttribute(VIEW_MORE_MENU_ATTR, '');
            const trigger = document.querySelector(`[class*="${VIEW_MORE_ANCHOR_CLASS}"] button[aria-haspopup="menu"][aria-expanded="true"]`);
            if (trigger === null) return;
            // Watch first (it clears any previous mark), then close and mark: the
            // tab-strip watcher must not treat the mark it is about to guard as stale.
            watchTabs(trigger);
            trigger.click();
            trigger.setAttribute(VIEW_MORE_EMPTY_ATTR, '');
          }

          const observer = new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                const surface = node.hasAttribute(MENU_SURFACE_ATTR)
                  ? node
                  : node.querySelector(`[${MENU_SURFACE_ATTR}]`);
                if (surface === null) continue;
                if (typeof surface.className !== 'string') continue;
                if (!surface.className.includes(VIEW_MORE_MENU_CLASS)) continue;
                filter(surface);
              }
            }
          });
          observer.observe(document.body, { childList: true });

          return () => {
            observer.disconnect();
            restoreLaunchers();
          };
        }

        /**
         * Mounts {@link mountViewActions} for as long as the plugin is loaded;
         * like the 「更多」 pass it only corrects DOM the shell owns, so the
         * overlay occupant paints nothing.
         */
        function ViewActions() {
          React.useEffect(() => mountViewActions(), []);
          return null;
        }

        /**
         * Hide the conversation view row's 「更多」 launcher when no view tab is
         * folded behind it — without waiting for a click.
         *
         * The launcher exists because `entry-customization` registers rows into
         * the view actions seat, and {@link mountViewActions} removes those rows;
         * with nothing folded, the menu would open empty. The shell already
         * decides what is folded with one line — it shows
         * `floor((rowWidth - 48) / 120)` tabs and pushes the rest into this menu
         * — so the same arithmetic over the registered `conversation.view`
         * entries answers the question up front. A view that *is* folded keeps
         * the launcher, so it stays reachable.
         *
         * Called from the session header's actions seat, so it mounts with the
         * header; re-syncs on every header render (the blank→conversation flip
         * is what paints the tab row), on a resize of the row (the tab limit is
         * width-derived) and when the `conversation.view` ledger changes.
         */
        function syncViewMoreVisibility() {
          const tabs = document.querySelector(`[${CONVERSATION_TABS_ATTR}]`);
          const row = tabs === null ? null : tabs.parentElement;
          if (row === null) return;
          const anchors = row.querySelectorAll(`[class*="${VIEW_MORE_ANCHOR_CLASS}"]`);
          if (anchors.length === 0) return;
          let views = 0;
          try {
            views = ctx.slots.entries('conversation.view').length;
          } catch (reason) {
            console.warn('[daily-chat] reading the conversation views failed:', reason);
            return;
          }
          const visibleLimit = Math.max(1, Math.floor((row.clientWidth - 48) / 120));
          const folded = views > visibleLimit;
          for (const anchor of anchors) {
            if (folded) anchor.removeAttribute(VIEW_MORE_EMPTY_ATTR);
            else anchor.setAttribute(VIEW_MORE_EMPTY_ATTR, '');
          }
        }

        /**
         * The bridge that runs {@link syncViewMoreVisibility} while a session
         * header is mounted: the header, not the plugin, owns when the tab row
         * exists, so the plugin hangs this off a seat in the header that paints
         * nothing.
         */
        function ViewMoreWatch() {
          React.useEffect(() => {
            syncViewMoreVisibility();
            const tabs = document.querySelector(`[${CONVERSATION_TABS_ATTR}]`);
            const row = tabs === null ? null : tabs.parentElement;
            const resize = typeof ResizeObserver === 'function' && row !== null
              ? new ResizeObserver(() => syncViewMoreVisibility())
              : null;
            if (resize !== null) resize.observe(row);
            const stop = ctx.slots.subscribe('conversation.view', () => syncViewMoreVisibility());
            return () => {
              if (resize !== null) resize.disconnect();
              stop();
            };
          }, []);
          // Every header render (blank → conversation included) re-evaluates.
          React.useEffect(() => {
            syncViewMoreVisibility();
          });
          return null;
        }

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
         * surfaces as a transient card on the frame-wide overlay layer. This is
         * the plugin's own failure card (the shipped toast is for row actions,
         * see {@link RowActionToast}); action failures use that one instead.
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

        /**
         * The row-action notice: the shipped `Toast` primitive, carrying the
         * same sentence and the same inline actions the workspace browser uses
         * for its own pin/archive rows.
         *
         * That is the whole point of this component — an archive in 日常 must
         * read 「会话已归档，可 [撤销] 或 [筛选已归档会话]」 at the same place
         * DSH puts it, not a second, different card. The primitive owns the
         * placement (top center, portalled to `<body>`), the success/warning
         * mark and the hold timer; this component only supplies its content.
         *
         * A primitives build without `Toast` falls back to the plugin's own
         * corner card with the same text and buttons, so the action is still
         * recoverable — just not in the shipped clothes.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @returns the notice, or null when there is none.
         */
        function RowActionToast(props) {
          const t = props.t;
          const chat = useChatState();
          const notice = chat.notice;
          if (notice === null) return null;
          const actions = Array.isArray(notice.actions) ? notice.actions : [];

          if (ToastComponent !== null) {
            const toastProps = {
              key: notice.seq,
              text: notice.text,
              onDone: dismissNotice,
              ...(notice.tone === 'success' ? { tone: 'success' } : {}),
              ...(notice.tone === 'warning' && WarningGlyph !== null ? { icon: h(WarningGlyph, {}) } : {}),
              ...(notice.holdMs === undefined ? {} : { holdMs: notice.holdMs }),
              ...(actions.length === 0 ? {} : { actions }),
            };
            return h(ToastComponent, toastProps);
          }

          return h('div', { className: 'dsc-toast', role: 'status' }, [
            h('style', { key: 'css' }, CSS),
            h('div', { className: 'dsc-toast-body', key: 'body' }, [
              h('div', { className: 'dsc-toast-text', key: 'text' }, notice.text),
              actions.length === 0 ? null : h('div', { className: 'dsc-toast-actions', key: 'actions' },
                actions.map((action, index) => h('button', {
                  key: String(index),
                  type: 'button',
                  className: 'dsc-toast-action',
                  onClick: () => {
                    if (typeof action.onClick === 'function') action.onClick();
                  },
                }, action.label))),
            ]),
            h('button', {
              key: 'close',
              type: 'button',
              className: 'dsc-toast-close',
              onClick: dismissNotice,
            }, t('dismiss')),
          ]);
        }

        /* ── the daily browsing region ────────────────────────────────────── */

        /**
         * One 24px bare icon in a row's hover band, carrying the workspace
         * browser's own tooltip and aria label.
         * @param props.label - what the control does.
         * @param props.glyph - the primitives icon component.
         * @param props.run - the action.
         * @returns the button, optionally wrapped in a tooltip.
         */
        function RowActionButton(props) {
          const button = h('button', {
            type: 'button',
            className: 'dsc-rowact',
            'aria-label': props.label,
            onClick: (event) => {
              event.stopPropagation();
              props.run();
            },
          }, h(props.glyph, { size: 14 }));
          return withTooltip(props.label, button);
        }

        /**
         * One daily session row: the workspace browser's own 32px row, plus the
         * two actions this list did not have before.
         *
         * Presentation is the shipped row's, line for line — status dot, title,
         * then a resting cell holding the relative age and (when pinned) the
         * same 14px pin marker 工作 draws. Hovering retires that cell and brings
         * up archive and pin, archive first exactly as in the shipped order.
         * An archived row is muted, keeps its age, and offers unarchive instead
         * of archive; clicking it is refused with the shipped explanation
         * rather than opening it.
         *
         * The row is a `div role="treeitem"`; on a real key press Enter/Space
         * open it, while the nested action buttons keep their own clicks.
         *
         * @param props.row - the derived row (with `pinned` / `archived` flags).
         * @param props.now - epoch ms for the age cell.
         * @param props.selected - whether this session is the open one.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @param props.useSessionAccess - the standard session access hook.
         * @param props.onOpen - open the session (or refuse, when archived).
         * @param props.onArchive / props.onUnarchive - archive actions.
         * @param props.onPin / props.onUnpin - pin actions.
         * @returns the row.
         */
        function DailyRow(props) {
          const t = props.t;
          const row = props.row;
          const useSessionAccess = props.useSessionAccess;
          // The shipped browser gates each action on the session's access
          // snapshot. Both hook calls happen unconditionally, so the hook order
          // is the same whether the row is pinned or archived; when the standard
          // prop is absent (an older shell) nothing is gated, which is the
          // status quo this list had before row actions existed.
          const canArchive = typeof useSessionAccess === 'function'
            ? useSessionAccess(row.id, row.archived ? 'workspace/unarchiveSession' : 'workspace/archiveSession')
            : true;
          const canPin = typeof useSessionAccess === 'function'
            ? useSessionAccess(row.id, row.pinned ? 'workspace/unpinSession' : 'workspace/pinSession')
            : true;
          const open = () => props.onOpen(row);

          const actions = [];
          const archiveGlyph = row.archived ? UnarchiveGlyph : ArchiveGlyph;
          if (canArchive && archiveGlyph !== null) {
            actions.push(h(RowActionButton, {
              key: 'archive',
              label: t(row.archived ? 'unarchive' : 'archive'),
              glyph: archiveGlyph,
              run: () => (row.archived ? props.onUnarchive : props.onArchive)(row.id),
            }));
          }
          if (canPin && !row.archived && PinGlyph !== null) {
            actions.push(h(RowActionButton, {
              key: 'pin',
              label: t(row.pinned ? 'unpin' : 'pin'),
              glyph: row.pinned && PinFilledGlyph !== null ? PinFilledGlyph : PinGlyph,
              run: () => (row.pinned ? props.onUnpin : props.onPin)(row.id),
            }));
          }

          return h('div', {
            key: row.id,
            className: 'dsc-row' + (row.archived ? ' dsc-row-archived' : ''),
            role: 'treeitem',
            'aria-selected': props.selected === true,
            'aria-description': row.archived ? t('archivedNotOpenable') : undefined,
            tabIndex: 0,
            onClick: open,
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              event.preventDefault();
              open();
            },
          }, [
            h('span', {
              key: 'dot',
              className: 'dsc-dot' + (row.running ? ' dsc-dot-on' : ''),
            }),
            h('span', { key: 'title', className: 'dsc-rowtitle' }, row.displayTitle || row.id),
            // Trailing cell, the way a workspace row carries it: the title cell
            // keeps `flex:1` and clips, so the age (and the pin marker after it)
            // never squeeze the title to nothing and never wrap.
            h('span', { key: 'resting', className: 'dsc-rowresting' }, [
              h('span', { key: 'time', className: 'dsc-rowtime' }, timeLabel(row.updatedAt, props.now, t)),
              row.pinned && (PinFilledGlyph !== null || PinGlyph !== null) ? h('span', {
                key: 'pin',
                className: 'dsc-rowpin',
                role: 'img',
                'aria-label': t('pinned'),
                title: t('pinned'),
              }, h(PinFilledGlyph === null ? PinGlyph : PinFilledGlyph, { size: 14 })) : null,
            ]),
            actions.length === 0 ? null : h('span', {
              key: 'actions',
              className: 'dsc-rowactions',
              onClick: (event) => {
                event.stopPropagation();
              },
            }, actions),
          ]);
        }

        /**
         * The section header's 「视图选项」 control: which archived rows the list
         * shows. Same control, same three choices and same glyph as the workspace
         * browser's own view-options menu; absent when this deployment predates
         * the `Menu` primitive, in which case the list keeps the shipped default
         * (archived rows hidden).
         * @param props.filter - the current {@link ARCHIVED_FILTERS} value.
         * @param props.onFilter - switch the filter.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @returns the filter button, or null.
         */
        function DailyViewOptions(props) {
          const t = props.t;
          const [open, setOpen] = React.useState(false);
          if (MenuComponent === null) return null;
          const filter = props.filter;
          const selectedIds = [{
            default: 'hide-archived',
            show: 'show-archived',
            only: 'only-archived',
          }[filter] ?? 'hide-archived'];
          const glyphIcon = (glyph) => (glyph === null ? undefined : h(glyph, {}));
          const items = [
            { type: 'label', id: 'filter-by', text: t('filterLabel') },
            { id: 'hide-archived', label: t('hideArchived'), icon: glyphIcon(ArchiveOffGlyph) },
            { id: 'show-archived', label: t('showArchived'), icon: glyphIcon(QueueGlyph) },
            { id: 'only-archived', label: t('onlyArchived'), icon: glyphIcon(ArchiveCheckGlyph) },
          ];
          const anchor = withTooltip(t('viewOptions'), h('button', {
            type: 'button',
            className: 'dsc-new',
            'aria-label': t('viewOptions'),
            title: t('viewOptions'),
            onClick: () => setOpen((value) => !value),
          }, SlidersGlyph === null ? '⋯' : h(SlidersGlyph, {})));
          return h(MenuComponent, {
            open,
            onClose: () => setOpen(false),
            items,
            selectedIds,
            onSelect: (id) => {
              if (id === 'hide-archived') props.onFilter('default');
              else if (id === 'show-archived') props.onFilter('show');
              else if (id === 'only-archived') props.onFilter('only');
              setOpen(false);
            },
            align: 'end',
            dense: true,
            portal: true,
            anchor,
          });
        }

        /**
         * The stop-and-archive confirmation the shipped browser raises when the
         * Host refuses to archive a session that is still working.
         *
         * It lists the work that would be stopped and does nothing until the
         * reader confirms; confirm calls the stop-and-archive form of the same
         * archive call, and a failure keeps the dialog open with the reason.
         * @param props.t - translate seat bound to {@link LOCALE_NS}.
         * @returns the dialog, or null when nothing is pending.
         */
        function ArchiveConfirm(props) {
          const t = props.t;
          const chat = useChatState();
          const request = chat.archiveRequest;
          const [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState(null);
          React.useEffect(() => {
            setBusy(false);
            setError(null);
          }, [request === null ? null : request.sessionId]);
          if (request === null || ModalComponent === null) return null;

          const close = () => {
            if (busy) return;
            setState({ archiveRequest: null });
          };
          const confirm = () => {
            setBusy(true);
            setError(null);
            stopAndArchiveDaily(request.sessionId).catch((reason) => {
              setBusy(false);
              setError(describe(reason));
            });
          };
          const footerButton = (key, label, onClick) => (ButtonComponent === null
            ? h('button', { key, type: 'button', disabled: busy, onClick }, label)
            : h(ButtonComponent, { key, variant: 'outline', disabled: busy, onClick }, label));

          return h(ModalComponent, {
            open: true,
            onClose: close,
            closeLabel: t('cancel'),
            title: t('archiveConfirmTitle'),
            description: t('archiveConfirmDesc', { title: request.displayTitle }),
            footer: h(React.Fragment, null, [
              footerButton('cancel', t('cancel'), close),
              footerButton('confirm', t('archiveConfirmAction'), confirm),
            ]),
          }, [
            h('ul', {
              key: 'activity',
              className: 'dsc-archiveactivity',
              'aria-label': t('archiveConfirmActivity'),
            }, (Array.isArray(request.activity) ? request.activity : []).map((entry, index) => h('li', { key: String(index) }, archiveActivityLine(entry)))),
            busy ? h('div', { key: 'pending', className: 'dsc-archivestatus', role: 'status' }, t('archiveConfirmPending')) : null,
            error === null ? null : h('div', {
              key: 'error',
              className: 'dsc-archiveerror',
              role: 'alert',
            }, error),
          ]);
        }

        /**
         * The session list that stands in for the workspace browser in chat mode.
         *
         * A row is that browser's own row: status dot, title, and the trailing
         * cell with the relative age and, when pinned, the pin marker — same
         * words, same thresholds, same 10px tertiary age, same hover swap that
         * puts the archive and pin actions where the age was. Rows are ordered
         * the browser's way (pinned first, then by recency) and filtered the
         * browser's way (archived hidden, mixed in, or alone). What is left out
         * is what a daily chat cannot do — and nothing else.
         */
        function DailyRegion(props) {
          const t = props.t;
          const wide = props.wide !== false;
          const workspaces = useWorkspacesOf(props);
          const sessions = useSessionsOf(props);
          const chat = useChatState();
          // One clock for the whole list: every row's age is read against the
          // same instant, so two rows that are the same age never disagree.
          const now = useRelativeClock();

          const rows = dailyRows(workspaces, sessions, chat.archivedFilter);
          // The list paints one page at a time and adds a page whenever its
          // 1px end strip scrolls into view; see {@link usePagedRows}.
          const paged = usePagedRows(rows);
          const current = currentDailySessionId(sessions);

          /** Open a row: an archived chat is refused with the shipped notice. */
          const openRow = (row) => {
            if (row.archived) {
              notifyNotice(t('archivedNotOpenable'), 'warning');
              return;
            }
            openDaily(row.id);
          };

          const empty = chat.archivedFilter === 'only'
            ? h('div', { className: 'dsc-emptyarchived', key: 'empty' }, [
              ArchiveGlyph === null ? null : h(ArchiveGlyph, { key: 'glyph', size: 24 }),
              h('div', { key: 'text' }, t('noneArchived')),
              h('button', {
                key: 'others',
                type: 'button',
                className: 'dsc-emptylink',
                onClick: () => setArchivedFilter('default'),
              }, t('viewOthers')),
            ])
            : h('div', { className: 'dsc-empty', key: 'empty' }, chat.busy ? t('starting') : t('empty'));

          return h('div', { className: 'dsc-region' + (wide ? '' : ' dsc-rail') }, [
            h('style', { key: 'css' }, CSS),
            h('div', { className: 'dsc-head', key: 'head' }, [
              h('div', { className: 'dsc-title', key: 'title' }, t('dailyChats')),
              h('div', { className: 'dsc-headactions', key: 'actions' }, [
                h(DailyViewOptions, {
                  key: 'filter',
                  filter: chat.archivedFilter,
                  onFilter: setArchivedFilter,
                  t,
                }),
                // The shipped header's add control: same glyph, same two sizes
                // (16 in the expanded sidebar, 18 in the collapsed rail), same
                // hover-only paint — a text button here would be the one row of
                // the sidebar that speaks a different language.
                h('button', {
                  key: 'new',
                  type: 'button',
                  className: 'dsc-new',
                  title: t('newChat'),
                  'aria-label': t('newChat'),
                  onClick: () => {
                    void startDailyChat();
                  },
                }, AddGlyph === null ? '＋' : h(AddGlyph, { size: wide ? 16 : 18 })),
              ]),
            ]),
            // The wrapper the shipped browser wraps its own list in; see the
            // `.dsc-listArea` rule for why the scrollbar needs it.
            h('div', { className: 'dsc-listArea', key: 'listArea' },
              h('div', {
                className: 'dsc-list',
                key: 'list',
                ref: paged.listRef,
                role: 'tree',
                'aria-label': t('dailyChats'),
              }, rows.length === 0 ? empty
                : rows.slice(0, paged.visible).map((row) => h(DailyRow, {
                  key: row.id,
                  row,
                  now,
                  selected: row.id === current,
                  t,
                  useSessionAccess: props.useSessionAccess,
                  onOpen: openRow,
                  onArchive: archiveDaily,
                  onUnarchive: unarchiveDaily,
                  onPin: pinDaily,
                  onUnpin: unpinDaily,
                })).concat(paged.more ? [h('div', {
                  key: 'more',
                  className: 'dsc-pager',
                  ref: paged.sentinelRef,
                  'aria-hidden': 'true',
                })] : []))),
          ]);
        }

        /* ── registration ─────────────────────────────────────────────────── */

        // The labeled entry points: two full-width rows at the TOP of the
        // sidebar's global panel list — above 「插件」, which sits at order 0 —
        // rendered by the shell as icon + label like every other panel row. The
        // shell owns the buttons and calls `selectPanel(id)`, so each panellist
        // id MUST address a registered `main` panel or that call throws; each
        // pair of registrations is therefore one unit. The rest of the panel
        // list, DSH's own 「更多」 menu included, is the shell's and is left alone.
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

        // The 「更多」 expansion lives on this seat: its presence is what makes
        // the shell paint the 「更多」 row in the first place, and its content is
        // the fallback the native menu paints when the expansion has to stand
        // down (an unknown third-party row, no `react-dom` portal). This
        // registration is also the gate for {@link MovedPanelsStyle}: while it is
        // live the rows are hidden, and when the seat is missing the rows stay
        // exactly where the shell put them. `moreMenuReady` is published through
        // the store because the style seat mounts separately and has to repaint
        // when this one lands.
        ctx.slots.inject('sidebar.panellist.actions', () => {
          const dispose = ctx.slots.register({
            name: 'sidebar.panellist.actions',
            id: MOVED_ACTIONS_ID,
            order: MOVED_MENU_ORDER,
          }, MovedPanelsMenu);
          setState({ moreMenuReady: true });
          return () => {
            dispose();
            setState({ moreMenuReady: false });
          };
        });

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-chrome',
          order: 1,
        }, ChromeStyle));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-moved-panels',
          order: 2,
        }, MovedPanelsStyle));

        // The 「更多」 expansion. It paints its own rows (portaled over the
        // sidebar) and claims the trigger row's click, so it must be mounted for
        // as long as the plugin is; the rows it shows are gated on the menu seat
        // still being one it can carry.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-more-inline',
          order: 3,
          locale: LOCALE_NS,
        }, MoreExpansion));

        // The conversation view row's own 「更多」 menu: same idea, different menu.
        // It strips the two plugin-discovery rows and retires the launcher while
        // it would open empty.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-view-actions',
          order: 4,
        }, ViewActions));

        // And the launcher itself: while a session header is mounted, decide up
        // front whether anything is folded behind the 「更多」, and hide it when
        // nothing is. Hangs off the header's actions seat purely to know when a
        // tab row exists; it paints nothing.
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'daily-chat-view-more',
        }, ViewMoreWatch));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-error',
          order: 50,
          locale: LOCALE_NS,
        }, ErrorToast));

        // The row-action notice, painted through the shipped `Toast` primitive
        // so an archive reads exactly like the one 工作 raises — same sentence,
        // same inline 「撤销 / 或 筛选已归档会话」 actions, same place.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-row-toast',
          order: 50,
          locale: LOCALE_NS,
        }, RowActionToast));

        // The stop-and-archive confirmation, the same overlay entry the shipped
        // browser registers for its own archive action. It only ever paints
        // something while `state.archiveRequest` holds a refused archive.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'daily-chat-archive-confirm',
          order: 51,
          locale: LOCALE_NS,
        }, ArchiveConfirm));

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

        // The elapsed line in a settled Turn's footer — its two faces.
        //
        // `conversation.chat.turnTail` is the seat DSH paints once per settled
        // Turn; the `turn` it hands over is the same Turn location the shipped
        // process header reads its duration from, so nothing has to be
        // subscribed to, stored or recomputed here. What is registered on it is
        // the carrier: the numbers, plus the line as it looks when the action
        // row below is not there to paint into.
        //
        // `conversation.chat.assistant-actions` is the other face, and the only
        // seat DSH renders *inside* the copy/branch/time row itself. Reading the
        // carrier back from there is what puts the figure on the row's own line,
        // after the usage figure and the clock, instead of on a line of its own.
        // Both seats are registered for both modes on purpose: the figure is
        // DSH's own and the line only ever repeats what the shipped header would
        // have shown had the default display modes not folded it away.
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: TURN_CONTRIBUTION,
          order: TURN_ORDER,
          locale: LOCALE_NS,
        }, TurnDuration));
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: TURN_INLINE_CONTRIBUTION,
          order: TURN_ORDER,
          locale: LOCALE_NS,
        }, TurnElapsed));

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

        // Work mode does not list the daily workspace.
        //
        // The filter sits on the model PROTOTYPE for the same reason the two
        // navigation patches do: Cordis hands each consumer a fresh traceable
        // proxy of one shared model, and the sidebar published its own proxy as
        // the `workspaces` hook long before this plugin loaded. Only the shared
        // prototype reaches it — and the hook calls `getSnapshot()` through that
        // proxy on every read, so the projection needs no resubscription to take
        // effect.
        ctx.inject(['workspaces'], (workspaceCtx) => {
          workspaceCtx.effect(() => {
            const model = workspaceCtx.workspaces.list;
            const proto = model === null || model === undefined ? null : Object.getPrototypeOf(model);
            const original = proto === null ? undefined : proto.getSnapshot;
            if (typeof original !== 'function') return undefined;
            // The session projection below needs the daily workspace's own
            // account, so keep a way back to the unfiltered read.
            readRawWorkspaces = () => original.call(model);
            proto.getSnapshot = function getSnapshot() {
              return visibleWorkspaces(original.call(this));
            };
            return () => {
              proto.getSnapshot = original;
              readRawWorkspaces = undefined;
            };
          }, 'daily-chat: work mode hides the daily workspace');
        });

        // The daily chats go with the workspace.
        //
        // This store is an OBJECT, not a class instance — `createSnapshotStore`
        // hands back an object literal with `getSnapshot` on it — so unlike the
        // three patches above this one replaces the method on the object itself.
        // That is enough: the browser publishes this very object as the
        // `sessions` hook (`provideRoot({ hooks: { sessions: sessions.list } })`),
        // so every `useSessions` reader sees the projection.
        ctx.inject(['sessions'], (sessionCtx) => {
          sessionCtx.effect(() => {
            const store = sessionCtx.sessions.list;
            if (store === null || store === undefined) return undefined;
            const original = store.getSnapshot;
            if (typeof original !== 'function') return undefined;
            try {
              store.getSnapshot = function getSnapshot() {
                return visibleSessions(original.call(this));
              };
            } catch (reason) {
              console.warn('[daily-chat] hiding the daily chats from work mode failed:', reason);
              return undefined;
            }
            return () => {
              try {
                store.getSnapshot = original;
              } catch (reason) {
                console.warn('[daily-chat] restoring the session list failed:', reason);
              }
            };
          }, 'daily-chat: work mode hides the daily chats');
        });
      },
    };
  },
});
