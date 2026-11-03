import type { ChatCompletionTool } from './openai-types'

const pointerPositionSchema = {
  type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'],
}
const pointerMotionSchema = {
  description: 'Optional motion override. Omit to inherit browser settings; false disables interpolation while coordinate actions retain one closed native batch. intervalMs and sampleRateHz are mutually exclusive. No retries after partial dispatch.',
  anyOf: [
    { type: 'boolean' },
    {
      type: 'object',
      properties: {
        durationMs: { type: 'number', description: 'Base movement duration in milliseconds; omit for automatic distance/target-width timing.' },
        speedMultiplier: { type: 'number', description: 'Positive speed multiplier. 1.05 is 5% faster; 0.95 is 5% slower.' },
        intervalMs: { type: 'number', description: 'Positive milliseconds between planned samples; fractions allowed, final interval may be shorter.' },
        sampleRateHz: { type: 'number', description: 'Alternative to intervalMs, 1..240 Hz (default 120).' },
        timing: { type: 'string', enum: ['lognormal', 'minimum-jerk'] },
        curvature: { type: 'number', description: 'Relative curve bend, 0..1.' },
        jitterPx: { type: 'number', description: 'Smooth spatial variation, 0..10 CSS pixels.' },
        targetWidthPx: { type: 'number', description: 'Positive effective target width for automatic duration.' },
        holdMs: { type: 'number', description: 'Explicit-coordinate click dwell, 0..1000 ms (default 50). Requires browser_mouse(action=click) or browser_click with target+x/y; selector center-click cannot set dwell.' },
        seed: { anyOf: [{ type: 'string' }, { type: 'number' }], description: 'Reproducible geometry and timing.' },
      },
      additionalProperties: false,
    },
  ],
}

/** OpenAI-compatible tool schemas for Navora browser agent. */
export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'agent_ask_user',
      description:
        'Ask/decision UI: ask the user ONE blocking decision when the next action is ambiguous or high-impact. Use instead of writing A/B/C/D in chat. Do NOT use to re-confirm an intent the user already stated (e.g. they said download → just download). One question per call; for multi-step wizards call again after each answer with the same forkGroup/forkTitle and increasing step. Options: 2–6 concrete action labels (not "选项A"); optional hint + recommended. timeoutMs overrides Settings default unless Settings is unlimited.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'One short decision for THIS step only (Chinese preferred). No preamble, no multi-question paragraph, no restating the whole task.',
          },
          options: {
            type: 'array',
            description:
              '2–6 mutually exclusive choices. Prefer { label, hint?, recommended? }. label = concrete outcome the user picks (e.g.「下载到默认目录」「只要链接」), never bare A/B/C or「选项1」.',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: 'Short concrete choice label (shown as the button text)',
                    },
                    hint: {
                      type: 'string',
                      description: 'One-line consequence if this option is chosen (optional)',
                    },
                    recommended: {
                      type: 'boolean',
                      description: 'Preferred option (at most one across the list)',
                    },
                  },
                  required: ['label'],
                },
              ],
            },
          },
          recommended: {
            type: 'string',
            description: 'Label of the recommended option (alternative to option.recommended)',
          },
          allowCustom: {
            type: 'boolean',
            description:
              'Allow free-text answer (default true). Set true when collecting secrets/IDs/URLs; false for strict yes/no or exclusive paths.',
          },
          timeoutMs: {
            type: 'number',
            description:
              'Wait for the user (ms). Omit = Settings → 询问/决策 default (unlimited / 0). Ignored when Settings is unlimited. 0 = wait forever. Positive values clamped to 5000–600000.',
          },
          step: {
            type: 'number',
            description:
              '1-based index in a cascade. Must increase by 1 each call in the same forkGroup; do not skip or restart mid-flow.',
          },
          totalSteps: {
            type: 'number',
            description:
              'Planned total steps when known. Keep stable within a forkGroup; raise only if the cascade truly grows after an answer.',
          },
          forkGroup: {
            type: 'string',
            description:
              'Stable snake_case id for one cascade (e.g. "stress_setup"). Reuse for every step of the same wizard; never invent a new group mid-flow for the same task.',
          },
          forkTitle: {
            type: 'string',
            description:
              'Short dialog title for the whole cascade (e.g.「压力测试配置」). Same string on every step of the forkGroup.',
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agent_spawn_subchat',
      description:
        'Spawn an async parallel sub-conversation (isolated Agent run) for a focused sub-task. Returns immediately with subChatId while the child runs in the background. Use for parallel research, long tool chains, or noisy browsing that should not pollute the parent timeline. Pass a concise goal + the context the child needs (do NOT dump full parent history). CRITICAL: the child cannot see parent messages — always put every required URL, sitekey, id, path, and constraint into goal and/or context (e.g. Turnstile needs the real page URL, never invent example.com). Sub-chat browser resources remain available after done/failed/cancelled; each Agent decides when to explicitly release unneeded windows or Sessions. After spawning one or more children, call agent_await_subchats to collect results. Sub-chats cannot spawn further children. Concurrent children per parent are capped by Settings → 子对话 (default 4; parent itself is not counted).',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Clear, self-contained task for the sub-agent (becomes its user message + title)',
          },
          context: {
            type: 'string',
            description:
              'Short briefing the child must have: include ALL relevant http(s) URLs, sitekeys, ids, and constraints from the user. Keep under ~2k chars; child does NOT inherit parent message history.',
          },
          inheritWorkspace: {
            type: 'boolean',
            description:
              'If true and parent has a custom workspaceRoot, child uses the same folder (default false — isolated workspace).',
          },
        },
        required: ['goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agent_await_subchats',
      description:
        'Wait until one or more previously spawned sub-chats finish (or timeout). Returns status + summary for each. Prefer awaiting after you have spawned all parallel children. Omit subChatIds to wait for every running child of this chat.',
      parameters: {
        type: 'object',
        properties: {
          subChatIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sub-chat ids from agent_spawn_subchat. Omit = all children of this parent still tracked.',
          },
          timeoutMs: {
            type: 'number',
            description:
              'Max wait in ms (default 300000). 0 = wait forever. Clamped to 5000–600000 when positive.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agent_subchat_status',
      description:
        'Non-blocking poll of sub-chat status/summary. Use when you want to continue other work and check progress later. Omit subChatIds to list all children of this parent.',
      parameters: {
        type: 'object',
        properties: {
          subChatIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific sub-chat ids; omit for all children of this parent.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'datetime_now',
      description:
        'Get a fresh local timestamp when precise elapsed time is needed. The host already supplies the current date/time at run start: use that for today/year references; do not call just to look up today’s date.',
      parameters: {
        type: 'object',
        properties: {
          locale: {
            type: 'string',
            description: 'BCP 47 locale for formatted strings (default zh-CN)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'weather_get',
      description: 'Read current weather and 7-day forecast directly from Open-Meteo, without opening a browser. Prefer this for weather questions. Supply an explicit city in location (include province/country if ambiguous); omit location to use permission-checked device/IP location automatically. No separate datetime/geolocation call needed. Cite source and date; never invent missing observations. On failure report it or try a different source once, never poll the same loading page.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Explicit user-specified city, optionally followed by comma and province/country. Omit for local weather.' },
          days: { type: 'integer', minimum: 1, maximum: 7, description: 'Forecast days including today. Default 1; tomorrow requires 2, a week requires 7.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'geolocation_get',
      description:
        'Get the user’s approximate location (coordinates + city when available). Use for “附近/周边/本地/我附近的…”, local weather, maps, or distance. Do NOT claim you cannot access location — call this tool first (user may need to approve browser.geolocation). Prefers device GPS, falls back to IP geolocation.',
      parameters: {
        type: 'object',
        properties: {
          prefer: {
            type: 'string',
            enum: ['auto', 'device', 'ip'],
            description:
              'auto (default): try device then IP; device: GPS/OS only; ip: network approximate only (no GPS prompt path beyond permission).',
          },
          timeoutMs: {
            type: 'number',
            description: 'Device location timeout in ms (default 12000)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description:
        'One-shot: create ONE Session + ONE BrowserWindow (only when this Chat has no usable session yet). Prefer the final target url (official site / direct search URL). Do NOT call again while a window still exists — reuse windowId with browser_navigate/browser_get. If a session exists but windows are empty (user closed the window), calling again reopens a window on that session. Never use file:// to open a local folder — use file_open / file_reveal instead.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Initial page URL (preferred). Defaults to about:blank.',
          },
          persist: {
            type: 'boolean',
            description:
              'Request persisted Session (default false). Use true only when user asks for persistence/login retention, or task needs durable cookies/storage. If denied, falls back to ephemeral.',
          },
          ua: { type: 'string', description: 'Optional User-Agent override' },
          show: {
            type: 'boolean',
            description:
              'Show the window. Omit to inherit settings → 浏览器 →「新建 Agent 窗口默认显示」(show_agent_windows).',
          },
          width: {
            type: 'number',
            description: 'Optional window width (px). Omit → settings default_width.',
          },
          height: {
            type: 'number',
            description: 'Optional window height (px). Omit → settings default_height.',
          },
          waitUntil: {
            type: 'string',
            enum: ['none', 'load', 'text_stable'],
            description:
              'Prefer load (default when url set). Avoid text_stable on search/ad-heavy pages — it often never settles.',
          },
          timeoutMs: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_session_create',
      description:
        'Create a browser Session without a window (rare). Prefer browser_open for browsing. Default is ephemeral. Only set persist:true when the user asks to keep login/cookies across restarts, or when the task clearly requires a durable session. If persist is denied, an ephemeral Session is created instead.',
      parameters: {
        type: 'object',
        properties: {
          persist: {
            type: 'boolean',
            description:
              'Request persisted Session (default false). Use true only when user asks for persistence/login retention, or task needs durable cookies/storage. If denied, falls back to ephemeral.',
          },
          ua: { type: 'string', description: 'Optional User-Agent override' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_session_close',
      description: 'Explicitly release a Session when the Agent judges it is no longer needed. Destroys all its windows and clears cookies/storage. Prefer browser_window_close if only the page is no longer needed; keep the Session for reuse. Do not clear login, active downloads or user-requested retained state.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_session_clear',
      description:
        'Clear cookies/storage for a Session without closing windows. After clear, call browser_navigate (or browser_open if no window) to reload the target URL — do not only narrate that you will clear.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_session_set_proxy',
      description: 'Set or clear HTTP proxy for a Session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          proxyRules: { type: 'string', description: 'e.g. http://127.0.0.1:7890; empty string clears' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_session_set_ua',
      description: 'Override User-Agent for a Session (and its windows).',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          userAgent: { type: 'string' },
        },
        required: ['sessionId', 'userAgent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_session_fetch',
      description:
        'HTTP request via Session.fetch (shares cookies/proxy/UA). Prefer for APIs/JSON/static HTML without opening a visible window. For API-only tasks: browser_session_create then fetch — do not browser_open. DEFAULT: fills missing browser navigation-like headers (Accept / Accept-Language / Sec-Fetch-* / Upgrade-Insecure-Requests / UA) in navigation wire order — do NOT hand-roll a full navigation header set unless you must override specific fields.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          url: { type: 'string' },
          method: { type: 'string' },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'Optional overrides/extra headers. Defaults already include ordered navigation-like headers; only pass what you need to change (e.g. Content-Type, Authorization, Referer).',
          },
          body: { type: 'string' },
          redirect: { type: 'string', enum: ['follow', 'error'] },
        },
        required: ['sessionId', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_cookies_get',
      description: 'List cookies for a Session (optional url filter).',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_cookies_set',
      description: 'Set a cookie on a Session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          url: { type: 'string' },
          name: { type: 'string' },
          value: { type: 'string' },
          domain: { type: 'string' },
          path: { type: 'string' },
          secure: { type: 'boolean' },
          httpOnly: { type: 'boolean' },
          expirationDate: { type: 'number', description: 'Unix epoch seconds' },
        },
        required: ['sessionId', 'url', 'name', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_cookies_remove',
      description: 'Remove cookies matching filters from a Session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          url: { type: 'string' },
          name: { type: 'string' },
          domain: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_window_create',
      description:
        'Create another BrowserWindow under an existing Session. For first browse, prefer browser_open (session+window in one call). Prefer passing url. Soft-waits for main-frame load when wait.load is on; may return partial/loading.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          url: { type: 'string' },
          show: {
            type: 'boolean',
            description:
              'Show the window. Omit to inherit settings show_agent_windows.',
          },
          width: {
            type: 'number',
            description: 'Optional width (px). Omit → default_width.',
          },
          height: {
            type: 'number',
            description: 'Optional height (px). Omit → default_height.',
          },
          waitUntil: {
            type: 'string',
            enum: ['none', 'load', 'text_stable'],
            description: 'none=return immediately; load=main frame; text_stable=body text quiet briefly',
          },
          timeoutMs: { type: 'number' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_window_close',
      description: 'Release a browser window when the Agent judges the page is no longer needed. Keeps its Session for reuse. Preserve pages needed for follow-up, login, active downloads or user inspection; completion alone does not require closing.',
      parameters: {
        type: 'object',
        properties: { windowId: { type: 'string' } },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_window_set_visible',
      description:
        'Show or hide an existing browser window without destroying it. Does not change size.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          visible: { type: 'boolean' },
        },
        required: ['windowId', 'visible'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_window_set_bounds',
      description:
        'Resize and/or move an existing browser window. Pass any of width/height/x/y; omitted fields keep current values. Works while the window is hidden.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          width: { type: 'number', description: 'Outer width in px (min 320)' },
          height: { type: 'number', description: 'Outer height in px (min 240)' },
          x: { type: 'number', description: 'Optional screen X' },
          y: { type: 'number', description: 'Optional screen Y' },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_window_focus',
      description:
        'Focus a browser window. By default does not change visibility (hidden windows stay hidden). Pass show:true to show then focus.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          show: {
            type: 'boolean',
            description: 'If true, show the window before focusing (default false)',
          },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description:
        'Navigate a window to a URL (preferred over click when the target href/url is already known). Soft-timeout returns ok with partial/loading instead of hanging. For search, prefer a full search URL (e.g. https://www.baidu.com/s?wd=...). After browser_find, if a result has url/href, navigate to it instead of clicking. Do not navigate to file:// directories — use file_open / file_reveal.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          url: { type: 'string' },
          timeoutMs: { type: 'number' },
          waitUntil: {
            type: 'string',
            enum: ['none', 'load', 'text_stable'],
          },
        },
        required: ['windowId', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_load_url_with_response',
      description:
        'Load a URL in a window but serve a custom main-document body (status/headers/body). Address bar and origin stay on the given URL; subresources still go to the network. Use for harness/shell pages that must run under a real site origin. Soft-timeout returns ok with partial/loading.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          url: {
            type: 'string',
            description: 'Document URL (http/https). Origin/address bar use this URL.',
          },
          body: {
            type: 'string',
            description: 'Main document body (usually HTML).',
          },
          statusCode: {
            type: 'number',
            description: 'HTTP status for the main document (default 200)',
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'Optional response headers. Default Content-Type is text/html; charset=utf-8 when omitted.',
          },
          timeoutMs: { type: 'number' },
          waitUntil: {
            type: 'string',
            enum: ['none', 'load', 'text_stable'],
          },
          prefer: {
            type: 'string',
            enum: ['native', 'protocol'],
            description:
              'Document inject path: native=loadURLWithResponse; protocol=session.protocol.handle backup',
          },
          injectMode: {
            type: 'string',
            enum: ['native', 'protocol'],
            description: 'Alias of prefer',
          },
        },
        required: ['windowId', 'url', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_back',
      description: 'Go back in window history.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          timeoutMs: { type: 'number' },
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_forward',
      description: 'Go forward in window history.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          timeoutMs: { type: 'number' },
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_reload',
      description: 'Reload the current page.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          timeoutMs: { type: 'number' },
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description:
        'Generic wait helper. Prefer until* conditions: untilSelector (element appears, pierces shadow), untilGone, untilTextContains, untilTitleContains / untilTitleNotContains, untilUrlContains / untilUrlNotContains. Soft-timeout returns ok with matched:false. Also supports load / text_stable / delayMs.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          untilSelector: {
            type: 'string',
            description: 'Wait until this CSS selector appears (pierce closed shadow by default)',
          },
          untilGone: {
            type: 'string',
            description: 'Wait until this CSS selector is no longer present',
          },
          untilTextContains: {
            type: 'string',
            description: 'Wait until document.body.innerText contains this substring',
          },
          untilTitleContains: { type: 'string' },
          untilTitleNotContains: {
            type: 'string',
            description: 'Wait until document.title no longer contains this substring',
          },
          untilUrlContains: { type: 'string' },
          untilUrlNotContains: { type: 'string' },
          selector: {
            type: 'string',
            description: 'Alias of untilSelector (legacy)',
          },
          pierce: { type: 'boolean', description: 'Pierce shadow when waiting for selector (default true)' },
          load: { type: 'boolean' },
          textStable: { type: 'boolean' },
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
          delayMs: { type: 'number' },
          timeoutMs: { type: 'number', description: 'Cap for this wait (default action_timeout_ms)' },
          pollMs: {
            type: 'number',
            description: 'Polling interval for until* checks (default 80)',
          },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description:
        'Trusted click. Selectors/refs use a smooth timed approach with dispatchInputSequence when available. Native targets retain center-click routing for iframe/hidden windows; supply explicit target-relative x/y plus motion for a timed targeted click. A stale target/ref requires a fresh snapshot. Existing iframeSelector plus innerSelector/offsets remains available.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: {
            type: 'string',
            description: 'Host-page selector, or inner selector when used with iframeSelector. Optional when ref is supplied.',
          },
          ref: { type: 'string', description: 'Exact element ref from the current page snapshot or browser_find' },
          target: { type:'object', properties:{webContentsId:{type:'number'},processId:{type:'number'},routingId:{type:'number'},documentId:{type:'number'},backendNodeId:{type:'number'}}, description:'Native target from browser_get(agent_snapshot/agent_find). Enables trusted click in iframe/shadow content without activating a hidden window; stale targets must be refreshed.' },
          iframeSelector: {
            type: 'string',
            description:
              'Host-page iframe CSS selector. When set, click is resolved inside that iframe (innerSelector or offsets).',
          },
          innerSelector: {
            type: 'string',
            description: 'Selector inside the iframe document (may fail on closed shadow; then use offsets)',
          },
          offsetX: { type: 'number', description: 'Click X offset from iframe top-left (px)' },
          offsetY: { type: 'number', description: 'Click Y offset from iframe top-left (px)' },
          offsetRatioX: {
            type: 'number',
            description: 'Click X as fraction of iframe width (0–1); default 0.12 when only iframeSelector',
          },
          offsetRatioY: {
            type: 'number',
            description: 'Click Y as fraction of iframe height (0–1); default 0.5',
          },
          pierce: {
            type: 'boolean',
            description: 'Pierce host-page shadow roots (default true)',
          },
          button: {
            type: 'string',
            enum: ['left', 'middle', 'right', 'back', 'forward'],
          },
          clickCount: { type: 'number' },
          x: { type: 'number', description: 'With native target: explicit CSS-pixel offset from element left; provide y too for timed click.' },
          y: { type: 'number', description: 'With native target: explicit CSS-pixel offset from element top; provide x too for timed click.' },
          from: pointerPositionSchema,
          motion: pointerMotionSchema,
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
          waitTimeoutMs: { type: 'number' },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_flow',
      description:
        'Run a short declarative page workflow in one call. Pass ordered steps (wait | click | delay) and optional retries. Consecutive wait(untilSelector)+click(iframeSelector) may be coalesced to click as soon as the element appears; optional until* clear step can short-poll between re-clicks. Soft failures retry per onStepError; permission/abort hard-fail. Cap with maxTotalMs. Prefer explicit steps; goal presets are optional shortcuts.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          goal: {
            type: 'string',
            enum: ['appear_then_click', 'click_when'],
            description:
              'Optional preset. appear_then_click / click_when: requires untilSelector or iframeSelector (expands to wait then click).',
          },
          preset: { type: 'string', description: 'Alias of goal' },
          iframeSelector: { type: 'string', description: 'Primary iframe selector for goals / overrides' },
          iframeSelectors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fallback iframe selectors to try when locating the host iframe',
          },
          untilSelector: { type: 'string', description: 'For appear_then_click: wait until this selector exists' },
          offsetRatioX: { type: 'number' },
          offsetRatioY: { type: 'number' },
          offsetVariants: {
            type: 'array',
            items: { type: 'number' },
            description: 'offsetRatioX values to cycle on each click attempt (default 0.08–0.20)',
          },
          locateTimeoutMs: { type: 'number' },
          clearTimeoutMs: { type: 'number' },
          steps: {
            type: 'array',
            description: 'Ordered steps. Each needs do: wait | click | delay. Fields match browser_wait / browser_click.',
            items: {
              type: 'object',
              properties: {
                do: { type: 'string', enum: ['wait', 'click', 'delay'] },
                action: { type: 'string', enum: ['wait', 'click', 'delay'] },
                untilSelector: { type: 'string' },
                untilGone: { type: 'string' },
                untilTextContains: { type: 'string' },
                untilTitleContains: { type: 'string' },
                untilTitleNotContains: { type: 'string' },
                untilUrlContains: { type: 'string' },
                untilUrlNotContains: { type: 'string' },
                selector: { type: 'string' },
                pierce: { type: 'boolean' },
                timeoutMs: { type: 'number' },
                delayMs: { type: 'number' },
                iframeSelector: { type: 'string' },
                iframeSelectors: { type: 'array', items: { type: 'string' } },
                innerSelector: { type: 'string' },
                offsetX: { type: 'number' },
                offsetY: { type: 'number' },
                offsetRatioX: { type: 'number' },
                offsetRatioY: { type: 'number' },
                button: { type: 'string' },
                clickCount: { type: 'number' },
                waitTimeoutMs: { type: 'number' },
              },
            },
          },
          retries: {
            type: 'number',
            description: 'Extra retries after first try (default 2, max 8)',
          },
          retryDelayMs: { type: 'number', description: 'Pause between retries (default 300)' },
          maxSettleDelayMs: { type: 'number' },
          clearCheckMs: {
            type: 'number',
            description:
              'When a flow ends with a clear-style wait after click, short poll budget between re-clicks (default 3500). Final attempt uses that step timeoutMs.',
          },
          onStepError: { type: 'string', enum: ['retry_from', 'retry_step', 'abort'] },
          retryFrom: { type: 'number' },
          maxTotalMs: { type: 'number' },
          clickJitter: { type: 'boolean' },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_hover',
      description:
        'Hover using windowId + ref from the latest snapshot. Native targets and CSS selectors remain supported. Motion inherits browser settings; only pass motion for a one-call adjustment. Never retry paused or invalidated actions.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: { type: 'string' },
          ref: { type: 'string', description: 'Short ref from the latest browser_get snapshot, agent_snapshot or agent_find.' },
          target: { type: 'object', description: 'Advanced: native target from the latest agent snapshot.' },
          pierce: { type: 'boolean', description: 'Pierce shadow roots (default true)' },
          from: pointerPositionSchema,
          motion: pointerMotionSchema,
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
          waitTimeoutMs: { type: 'number' },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_query_deep',
      description:
        'Locate one element via native Blink APIs, without page JS or debugger. Default searches closed/open shadow roots in the main document. acrossDocuments=true also searches frames, including cross-origin frames; scope explicitly, e.g. iframe#checkout button.submit. Returns main-viewport geometry and backendNodeId.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: { type: 'string' },
          pierce: { type: 'boolean', description: 'Pierce shadow roots (default true)' },
          acrossDocuments: { type: 'boolean', description: 'Use native querySelectorAcrossDocuments to include iframe documents (default false)' },
          agentInfo: { type:'boolean', description:'Return the coverage-aware native AgentSnapshot instead of the legacy geometry result (requires acrossDocuments=true).' },
          scrollIntoView: {
            type: 'boolean',
            description: 'Scroll matched element into view before measuring (default false)',
          },
        },
        required: ['windowId', 'selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll window or element. Use selector for scrollIntoView; deltaX/deltaY or to=top|bottom.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: { type: 'string' },
          deltaX: { type: 'number' },
          deltaY: { type: 'number' },
          to: { type: 'string', enum: ['top', 'bottom'] },
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
          waitTimeoutMs: { type: 'number' },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description:
        'Type into an element ref or CSS selector (clears unless append=true). For iframe/shadow fields or hidden windows, pass the current native target from agent_snapshot/agent_find. Re-read the page to verify the result. submit=true presses Enter.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          ref: { type: 'string', description: 'Element ref; use ref or selector' },
          target: { type:'object', properties:{webContentsId:{type:'number'},processId:{type:'number'},routingId:{type:'number'},documentId:{type:'number'},backendNodeId:{type:'number'}}, description:'Native target from browser_get(agent_snapshot/agent_find); supports trusted typing into iframe/shadow fields in hidden windows.' },
          append: { type: 'boolean' },
          submit: {
            type: 'boolean',
            description:
              'Press Enter after typing. If the page does not navigate, click the submit button yourself.',
          },
          waitUntil: {
            type: 'string',
            enum: ['none', 'load', 'text_stable'],
          },
          waitTimeoutMs: { type: 'number' },
        },
        required: ['windowId', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_press',
      description: 'Press a key (Enter, Tab, Escape, arrows…). Optional selector to focus first.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          key: { type: 'string' },
          selector: { type: 'string' },
          target: { type:'object', properties:{webContentsId:{type:'number'},processId:{type:'number'},routingId:{type:'number'},documentId:{type:'number'},backendNodeId:{type:'number'}}, description:'Native target from browser_get(agent_snapshot/agent_find); dispatches the key without activating the window.' },
        },
        required: ['windowId', 'key'],
      },
    },
  },
  {
    type:'function',
    function:{
      name:'browser_mouse',
      description:'Trusted pointer actions. move/click/drag generate a smooth timed trajectory in ONE native sequence; drag includes paired press/release. Without target, x/y/from are top-level viewport CSS pixels and x/y are required. With target, coordinates are element-relative CSS offsets, retaining hidden-window routing. Supply from for an explicit start; otherwise reuse the last completed position in the same coordinate scope (first viewport starts at 0,0; first target starts at its destination). Use motion.speedMultiplier/intervalMs to tune speed. Legacy down/up/wheel require a target; never split a native drag across separate sequence calls. Inspect status/dispatchedCount before retrying any failure.',
      parameters:{type:'object',properties:{windowId:{type:'string'},target:{type:'object',properties:{webContentsId:{type:'number'},processId:{type:'number'},routingId:{type:'number'},documentId:{type:'number'},backendNodeId:{type:'number'}}},action:{type:'string',enum:['move','click','drag','down','up','wheel']},x:{type:'number'},y:{type:'number'},from:pointerPositionSchema,motion:pointerMotionSchema,button:{type:'string',enum:['left','middle','right','back','forward']},clickCount:{type:'number'},buttons:{type:'number'},modifiers:{type:'number'},deltaX:{type:'number'},deltaY:{type:'number'}},required:['windowId','action']},
    },
  },
  {
    type:'function',
    function:{
      name:'browser_touch',
      description:'Dispatch a trusted touch event to a native agent target in the page. Coordinates are CSS-pixel offsets from the target element. Keep one target throughout a touch sequence; touchEnd/touchCancel use no points.',
      parameters:{
        type:'object',
        properties:{
          windowId:{type:'string'},
          target:{type:'object',properties:{webContentsId:{type:'number'},processId:{type:'number'},routingId:{type:'number'},documentId:{type:'number'},backendNodeId:{type:'number'}}},
          action:{type:'string',enum:['touchStart','touchMove','touchEnd','touchCancel']},
          touchPoints:{type:'array',items:{type:'object',properties:{x:{type:'number'},y:{type:'number'},id:{type:'number'},radiusX:{type:'number'},radiusY:{type:'number'},force:{type:'number'}},required:['x','y']}},
        },
        required:['windowId','target','action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_select',
      description: 'Select an option in a <select> by value or visible label.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: { type: 'string' },
          value: { type: 'string' },
          label: { type: 'string' },
          waitUntil: { type: 'string', enum: ['none', 'load', 'text_stable'] },
          waitTimeoutMs: { type: 'number' },
        },
        required: ['windowId', 'selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_upload',
      description: 'Set files on input[type=file]. paths are workspace-relative or absolute.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          path: { type: 'string' },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_find',
      description:
        'Snapshot search for interactive elements (text/aria/placeholder). NOT a waiter — times out in ~4s if the page is busy. After click/navigate, use browser_get instead of find. When a match has http(s) url/href, open it with browser_navigate — do not click.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          text: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['windowId', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_dialog',
      description:
        'List recent JS dialog events (alert/confirm/prompt/beforeunload) or set auto-accept policy. Requires unofficial Electron setJsDialogHandler (no debugger; CDP disabled). Page is never patched. Returns via: native.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          action: { type: 'string', enum: ['list', 'set_policy', 'clear'] },
          confirm: { type: 'boolean' },
          promptAccept: { type: 'boolean' },
          promptText: { type: 'string' },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get',
      description:
        'Read page info. Prefer agent_snapshot/agent_find for native DOM and accessibility data across same/cross-origin frames and open/closed shadow roots; inspect complete, frames and truncationReasons before treating absence as proof. Native targets can drive trusted input in hidden windows. Legacy snapshot/text/dom_summary remain available; capabilities probes actual runtime support.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          what: {
            type: 'string',
            enum: ['title', 'url', 'text', 'html', 'dom_summary', 'snapshot', 'agent_snapshot', 'agent_find', 'capabilities'],
            description: 'snapshot returns page-index refs; agent_snapshot and agent_find use native coverage-aware DOM/AX reading across frames and closed shadow roots; capabilities reports actual native API availability',
          },
          selector: { type: 'string', description: 'Optional scope for text/html' },
          query: { type: 'string', description: 'Optional snapshot index query, in Chinese or English' },
          limit: { type: 'number', description: 'Snapshot element limit, 1–80 (default 60)' },
          refresh: { type: 'boolean', description: 'Force rebuilding the page index instead of using a fresh cached index' },
          agentQuery: { type: 'object', properties: { selector:{type:'string'}, role:{type:'string'}, name:{type:'string'}, text:{type:'string'}, label:{type:'string'}, disabled:{type:'boolean'}, checked:{type:'string'}, selected:{type:'boolean'} }, description:'Native agent_find filter. If omitted, query is treated as text.' },
          maxNodes: { type:'number', description:'Native snapshot output cap (default 300, max 5000)' },
          maxFrames: { type:'number', description:'Native frame coverage cap (default 100, max 1000)' },
          agentTimeoutMs: { type:'number', description:'Native snapshot budget in milliseconds (default 5000, max 30000)' },
          pierce: { type:'boolean', description:'Include open and closed author shadow roots in native agent snapshots (default true)' },
          waitUntil: {
            type: 'string',
            enum: ['none', 'load', 'text_stable'],
            description: 'Default: short main-frame wait when loading; use text_stable for SPA',
          },
          waitTimeoutMs: {
            type: 'number',
            description: 'Cap for pre-get wait (default 8000); then reads whatever is available',
          },
        },
        required: ['windowId', 'what'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_evaluate',
      description:
        'Run JS in an isolated world (not page main world). Soft-waits briefly if loading. Return value must be JSON-serializable. On failure returns ok:false with error=script_error plus message/name/stack when available. Prefer browser_get when you only need page content.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          code: { type: 'string', description: 'Expression or IIFE returning a value' },
          waitUntil: {
            type: 'string',
            enum: ['none', 'load', 'text_stable'],
          },
          waitTimeoutMs: { type: 'number' },
        },
        required: ['windowId', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description:
        'Capture an Agent browser window (works even if hidden). By default captures the full visible viewport. Pass selector to capture a DOM element (scrolls it into view first), or clip {x,y,width,height} in viewport CSS pixels for a region. Saves PNG/JPEG into the Chat workspace and returns the relative path. Prefer browser_get for reading text; use screenshot when the user asks for an image, visual layout, or you need to save what the page/element looks like.',
      parameters: {
        type: 'object',
        properties: {
          windowId: { type: 'string' },
          selector: {
            type: 'string',
            description:
              'Optional CSS selector; capture that element after scrolling into view. Takes precedence over clip.',
          },
          clip: {
            type: 'object',
            description: 'Optional viewport region in CSS pixels: { x, y, width, height }',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          padding: {
            type: 'number',
            description: 'Extra pixels around the element when using selector (0–80, default 0)',
          },
          path: {
            type: 'string',
            description: 'Relative workspace path (default screenshots/page_<id>_<ts>.png)',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpeg'],
            description: 'Default png',
          },
          quality: {
            type: 'number',
            description: 'JPEG quality 1–100 (default 80); ignored for png',
          },
          maxWidth: {
            type: 'number',
            description: 'Optional max width in px; larger images are scaled down',
          },
          waitTimeoutMs: {
            type: 'number',
            description: 'When selector is set, max wait for the element (default 5000)',
          },
        },
        required: ['windowId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_screenshot',
      description:
        'Capture a desktop/monitor screenshot of this machine and save PNG/JPEG into the Chat workspace. Use when the user asks for desktop/screen capture (not a browser page). Requires permission.',
      parameters: {
        type: 'object',
        properties: {
          displayId: {
            type: 'number',
            description: 'Optional display id; default primary monitor',
          },
          path: {
            type: 'string',
            description: 'Relative workspace path (default screenshots/desktop_<ts>.png)',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpeg'],
            description: 'Default png',
          },
          quality: {
            type: 'number',
            description: 'JPEG quality 1–100 (default 80); ignored for png',
          },
          maxWidth: {
            type: 'number',
            description: 'Optional max width in px; larger images are scaled down',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_network_rule_add',
      description:
        'Add a webRequest rule: observe | modify headers | block. For observe, matching requests are buffered with statusCode + response/request headers (see browser_network_log). urlPattern MUST be a match pattern with scheme separator "://" (e.g. *://*.example.com/*). Do NOT use bare globs like *example.com* — that fails with Missing scheme separator.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          kind: { type: 'string', enum: ['observe', 'modify', 'block'] },
          urlPattern: {
            type: 'string',
            description:
              'Match pattern: <scheme>://<host>/<path>. Scheme/host/path may use *, but "://" is required. Valid: *://*.example.com/* , *://cdn.example.com/* , https://example.com/* . Invalid: *example.com* , *.example.com/* (missing scheme).',
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'For modify: request headers to set',
          },
        },
        required: ['sessionId', 'kind', 'urlPattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_network_rule_remove',
      description: 'Remove a network rule by id.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          ruleId: { type: 'string' },
        },
        required: ['sessionId', 'ruleId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_network_rule_list',
      description: 'List network rules for a Session (also returns a short recent log summary).',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_network_log',
      description:
        'Read buffered network observations for a Session (from observe rules). Each entry includes url, method, statusCode, requestHeaders, responseHeaders (sensitive values redacted). Pass clear:true to empty the buffer.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          limit: { type: 'number', description: 'Max entries to return (default 40, max 200)' },
          urlContains: { type: 'string', description: 'Case-insensitive URL substring filter' },
          status: { type: 'number', description: 'Only entries with this HTTP status code' },
          includePending: {
            type: 'boolean',
            description: 'Include in-flight requests not yet finalized (default false)',
          },
          clear: { type: 'boolean', description: 'If true, clear the log buffer and return' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_network_clear',
      description: 'Clear all network rules for a Session (log buffer kept; use browser_network_log clear:true to wipe logs).',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_list_resources',
      description: 'List current Chat browser Sessions and Windows (ids, titles, urls).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_info',
      description: 'Show absolute workspace root for this Chat (builtin / custom_root / chat override).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_set',
      description: "Set or clear this Chat's absolute workspace override. Empty path clears override.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute directory; empty string clears' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_list',
      description:
        'List files/dirs in this Chat workspace (sandboxed). Paths are relative to workspace root. Do NOT call repeatedly after file_download — trust the download result path/bytes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory, default .' },
          recursive: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_stat',
      description:
        'Stat a workspace file or directory. Prefer this over file_list when checking a single known path after download.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: 'Read a UTF-8 text file from workspace (truncated by config).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number', description: 'Character offset' },
          maxChars: { type: 'number' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description: 'Write or append UTF-8 text into a workspace file (creates parents).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          append: { type: 'boolean' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_mkdir',
      description: 'Create a directory in workspace (recursive).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_delete',
      description: 'Delete a file or directory in workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_move',
      description: 'Move/rename a workspace file or directory.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_copy',
      description: 'Copy a workspace file or directory.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_concat',
      description: 'Concatenate existing workspace files into one output file (in order).',
      parameters: {
        type: 'object',
        properties: {
          sources: { type: 'array', items: { type: 'string' } },
          dest: { type: 'string' },
        },
        required: ['sources', 'dest'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_download',
      description:
        'Active download: stream a known file URL into the Chat workspace via Session network (session.fetch). Prefer this when you already have a complete href. For “click the download button on the page”, use browser_click instead — that triggers passive download + system confirm UI; do NOT also agent_ask_user about saving. DEFAULT navigation-like headers (Accept / Accept-Language / Sec-Fetch-* / UA; no Origin). Always supply page Referer (or bind windowId/sessionId on the offering page); bare CDN URLs often 403. URL must be complete (path + all query tokens). Returns { ok, path, bytes, … }; after success use that path — do not spam file_list.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              'Complete download URL as obtained from the page (full absolute URL including query string). Do not truncate or drop sign/token/expiry params.',
          },
          dest: { type: 'string', description: 'Relative workspace path' },
          sessionId: { type: 'string' },
          windowId: {
            type: 'string',
            description: 'Optional browser window to take Referer from (and cookies via its session)',
          },
          referer: {
            type: 'string',
            description:
              'Page Referer required by default (the page that linked the file). Prefer this over Origin. Do NOT use the CDN file URL as Referer. If omitted and windowId/session page URL exists, that page is used — still prefer passing it explicitly.',
          },
          method: { type: 'string', description: 'HTTP method, default GET' },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'Optional overrides only. Navigation-like ordered defaults are already applied; do not set Origin for normal file downloads.',
          },
          body: { type: 'string', description: 'Optional request body' },
          bodyEncoding: {
            type: 'string',
            enum: ['utf8', 'base64'],
            description: 'How to decode body; default utf8',
          },
          range: { type: 'string', description: 'Optional Range header, e.g. bytes=0-1048575' },
        },
        required: ['url', 'dest'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_download_compose',
      description:
        'Compose multi-part streaming download: download parts in order and append into one workspace file. Use for segmented/range downloads or multi-URL assembly. Same defaults as file_download (ordered navigation-like headers via session.fetch); prefer page Referer on parts when anti-leech applies.',
      parameters: {
        type: 'object',
        properties: {
          dest: { type: 'string' },
          sessionId: { type: 'string' },
          parts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                headers: { type: 'object', additionalProperties: { type: 'string' } },
                method: { type: 'string' },
                body: { type: 'string' },
                bodyEncoding: { type: 'string', enum: ['utf8', 'base64'] },
                range: { type: 'string' },
              },
              required: ['url'],
            },
          },
        },
        required: ['dest', 'parts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_reveal',
      description:
        'Reveal a workspace path in the system file manager (Windows Explorer / macOS Finder). Paths are relative to the *current* workspace root (after workspace_set). To open/reveal the current workspace folder itself, omit path or use "." — do NOT pass the folder\'s own basename again (that would look for a nested child). Prefer file_open to open a folder; use file_reveal to select an item in its parent.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative to current workspace root (file or directory). Default: "." (workspace root).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_open',
      description:
        'Open a workspace file or folder with the OS default application (Explorer for directories). Paths are relative to the *current* workspace root. To open the current workspace folder, omit path or use "." — do NOT repeat the workspace folder basename as a child path.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative to current workspace root. Default: "." (workspace root).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell_exec',
      description:
        'Run a local command with cwd inside the current Chat workspace. Prefer file_list for listing workspace dirs/files, and file_reveal/file_open for Explorer. On Windows, allowlisted cmd builtins and npm/npx shims work (e.g. command=\"npm\" with args=[\"run\",\"plugin\",\"--\",\"build\",\"id\"]). Put only the executable basename in command; put the rest in args. Use only when a real process is required.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Executable basename only (e.g. dir, ls, git, npm). No path separators.',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments (e.g. for dir: ["/b"] or ["."] ).',
          },
          cwd: { type: 'string', description: 'Relative workspace cwd; default .' },
          shell: {
            type: 'boolean',
            description: 'Pass through OS shell (more powerful, riskier). Default false.',
          },
          timeoutMs: { type: 'number' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'app_settings_get',
      description:
        'Read Navora software settings (app / browser / files / ai / fork_decision / subchat / remote). Permissions are NOT available to the Agent — users manage them in Settings or the per-chat permission panel. Secrets are redacted: remote password hash and API keys are not returned (only api_key_ref + passwordConfigured). Use when the user asks what is configured or before changing settings.',
      parameters: {
        type: 'object',
        properties: {
          sections: {
            type: 'array',
            description:
              'Optional subset: app, browser, files, ai, fork_decision, subchat, remote. Omit to return all allowed sections. Do not request permissions.',
            items: {
              type: 'string',
              enum: ['app', 'browser', 'files', 'ai', 'fork_decision', 'subchat', 'remote'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'app_settings_update',
      description:
        'Update Navora software settings via a partial deep-merge patch (same sections as settings page, except permissions which are forbidden). Examples: { browser: { show_agent_windows: true } }, { app: { show_run_logs: false } }, { fork_decision: { enabled: false } }, { subchat: { enabled: true, max_parallel: 4 } }, { remote: { enabled: true, port: 8790 } }. To set remote password pass remote.password (plain text); do NOT send passwordHash. Prefer app_settings_get first. For ai.providers, incomplete rows are merged by id: { id, timeout_ms } only changes timeout and keeps models/base_url. A full providers array (each row has id + base_url + models) replaces the list. Do not send providers that omit models unless you only intend to patch the listed fields. To add an OpenAI-compatible provider from a /v1/models URL, prefer app_provider_add (shortcut: fetch + write); browser_session_fetch + app_settings_update also works. API Key is optional — many servers work without one; if auth is required, ask in chat via agent_ask_user then pass api_key to app_provider_add / app_models_list.',
      parameters: {
        type: 'object',
        properties: {
          patch: {
            type: 'object',
            description:
              'Partial AppConfig. Allowed top-level keys: app, browser, files, ai, fork_decision, subchat, remote. permissions is forbidden.',
          },
        },
        required: ['patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'app_models_list',
      description:
        'List models from an OpenAI-compatible HTTP endpoint via direct process fetch (no window). Pass base URL or full …/v1/models URL. API Key is optional — try without first. If the server returns 401/403, ask the user for a key in chat (agent_ask_user, allowCustom) and retry with api_key. Preferred shortcut for model discovery; browser_session_fetch is also fine if a Session already exists.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Provider base (…/v1) or models URL (…/v1/models).',
          },
          api_key: {
            type: 'string',
            description:
              'Optional API key for this request only (and to store when used with app_provider_add). Omit when the server needs no auth.',
          },
          api_key_ref: {
            type: 'string',
            description:
              'Optional existing secrets ref. Used if api_key is omitted. Prefer api_key after asking the user in chat.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Request timeout in ms (default 20000).',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'app_provider_add',
      description:
        'Add (or refresh) an OpenAI-compatible AI provider: fetch /v1/models with direct HTTP, then write into settings.ai.providers. Preferred one-shot shortcut when the user pastes a models URL. API Key is optional — omit for no-auth servers. If listing fails with 401/403, call agent_ask_user to collect the key in chat, then retry with api_key (it will be saved to the secrets store). Alternative: browser_session_fetch + app_settings_update.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Provider base (…/v1) or models URL (…/v1/models).',
          },
          label: {
            type: 'string',
            description: 'Display name in Settings (default derived from host).',
          },
          id: {
            type: 'string',
            description: 'Provider id; if an existing id is given, that provider is updated in place.',
          },
          api_key: {
            type: 'string',
            description:
              'Optional API key from the user (e.g. after agent_ask_user). Saved under api_key_ref. Omit when not required.',
          },
          api_key_ref: {
            type: 'string',
            description: 'Optional secrets ref; default secrets/<providerId>.',
          },
          model: {
            type: 'string',
            description: 'Default model id; must be in the fetched list (default: first model).',
          },
          set_default: {
            type: 'boolean',
            description: 'If true, set ai.default_provider to this provider.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Models request timeout in ms (default 20000).',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plugin_list',
      description:
        'List installed Agent plugins (executable tools), NOT skills. Use when the user asks about plugins / 插件. Returns id, name, description, version, enabled, tool names. Prefer this over skill_list for plugin questions.',
      parameters: {
        type: 'object',
        properties: {
          include_disabled: {
            type: 'boolean',
            description: 'If true, include disabled plugins (default false: enabled only).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plugin_read',
      description:
        'Read one plugin by id (from plugin_list or the「已启用插件」appendix): description, tool names, and optional README. Use for plugin capability questions. Never use skill_read for plugin ids (e.g. example-plugin).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Plugin id (e.g. example-plugin)' },
          include_readme: {
            type: 'boolean',
            description: 'If true (default), include README/docs.md when present (may be truncated).',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plugin_build',
      description:
        'Build a Navora plugin in the current Chat workspace (plugin-dev mode only). Invokes the navora-plugin CLI — prefer this over shell_exec. Output: dist/<packageId>/. By default also session-links that dist into *this chat + subchats only* (not global Settings). Set link=false to skip.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Platform artifact id, e.g. win32-x64, darwin-arm64, linux-x64. Defaults to this host.' },
          id: {
            type: 'string',
            description:
              'Project id under plugins root. Omit when workspace root already contains plugin.json (single-plugin mode).',
          },
          entry: {
            type: 'string',
            description: 'Optional packageId for multi-entry projects (builds one entry only).',
          },
          root: {
            type: 'string',
            description: 'Optional relative workspace path used as --root (default: workspace root).',
          },
          link: {
            type: 'boolean',
            description: 'If true (default), auto-link dist/<packageId> after a successful build.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plugin_pack',
      description:
        'Pack a built Navora plugin into zip(s) under the Chat workspace (plugin-dev mode). In-process — works in the packaged app, does not need navora-plugin CLI or a system Node. Run plugin_build first if dist is missing. Single-entry → dist/*-plugin.zip; multi-entry without entry also emits *-suite.zip. Prefer this over shell_exec.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Platform artifact id, e.g. win32-x64, darwin-arm64, linux-x64. Defaults to this host.' },
          id: {
            type: 'string',
            description: 'Project id; optional if workspace plugin.json has id.',
          },
          entry: {
            type: 'string',
            description: 'Optional packageId to pack a single variant.',
          },
          root: {
            type: 'string',
            description: 'Optional relative workspace --root (default: workspace root).',
          },
          out: {
            type: 'string',
            description: 'Optional output zip path relative to workspace.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plugin_check',
      description:
        'Validate built plugin dist (plugin-dev mode only). Prefer after plugin_build before linking/packing.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Platform artifact id, e.g. win32-x64, darwin-arm64, linux-x64. Defaults to this host.' },
          id: {
            type: 'string',
            description: 'Project id; omit in single-plugin workspace.',
          },
          entry: { type: 'string', description: 'Optional packageId for multi-entry.' },
          root: {
            type: 'string',
            description: 'Optional relative workspace --root (default: workspace root).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plugin_link',
      description:
        '外链-link a built plugin folder (dist/<packageId> with plugin.json + main.cjs) into the *current chat* (and its sub-chats) only — plugin-dev mode. Does not add to the global Settings plugin list. Prefer after plugin_build if auto-link was skipped.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative path to dist/<packageId>.',
          },
          overwrite: {
            type: 'boolean',
            description: 'Overwrite existing plugin with same id (default true).',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_search',
      description:
        'Search the local plugin/skill store catalog. Use when the user needs a capability that is not installed, or asks to browse/install from the store. Returns productId (not package variant id), name, description, installed state. Do NOT install — recommend and let the user confirm in UI. Prefer this over inventing plugin/skill ids.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['plugin', 'skill', 'all'],
            description: 'Filter by store kind (default all).',
          },
          q: {
            type: 'string',
            description: 'Optional search text (name, id, description).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_list',
      description:
        'List user Agent skills (Markdown playbooks / SKILL.md), NOT plugins. Do not use for「插件」or plugin tool questions — use plugin_list instead. Safe for skill lookup. Default: enabled only; include_disabled=true for all.',
      parameters: {
        type: 'object',
        properties: {
          include_disabled: {
            type: 'boolean',
            description: 'If true, include disabled skills (for update / avoid duplicates).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_read',
      description:
        'Read the full SKILL.md body of an enabled custom skill by id (from skill_list). NOT for plugins — plugin ids like example-plugin must use plugin_read. Required when a skill is marked 需 skill_read / disable-model-invocation, or when the injected body was truncated.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill id (never a plugin id)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_create',
      description:
        'Create a user skill ONLY when the user explicitly asks to create/add/write a skill (必须含「技能」意图). Do NOT call for business tasks like generate token, open a page, or solve a site flow — use enabled skills + browser tools instead. Opens a review dialog. Default wait=false.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Skill name / id style (letters, digits, hyphen). Keep short.',
          },
          description: {
            type: 'string',
            description: 'One-line when-to-use (≤200 chars).',
          },
          version: {
            type: 'string',
            description: 'Optional skill version (e.g. 1.0.0). Not required.',
          },
          body: {
            type: 'string',
            description:
              'Markdown steps. Keep concise (prefer ≤1500 chars) unless user asked for a long skill.',
          },
          disable_model_invocation: {
            type: 'boolean',
            description: 'If true, only catalog is injected; agent must skill_read before use.',
          },
          enabled: {
            type: 'boolean',
            description: 'Whether to enable after user confirms (default true).',
          },
          wait: {
            type: 'boolean',
            description:
              'Default false: do not block the turn. True: wait for confirm/cancel/defer.',
          },
        },
        required: ['name', 'description', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_update',
      description:
        'Update an existing skill by id ONLY when the user explicitly asks to modify that skill. Do not call proactively. Prefer short edits; default wait=false. Use skill_list(include_disabled=true) only when needed to find id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Existing skill id' },
          name: { type: 'string', description: 'New name (optional)' },
          description: { type: 'string', description: 'New description (optional)' },
          version: {
            type: 'string',
            description: 'Optional skill version (e.g. 1.0.0). Empty clears version.',
          },
          body: { type: 'string', description: 'New markdown body (optional; omit to keep)' },
          disable_model_invocation: { type: 'boolean' },
          enabled: { type: 'boolean' },
          wait: {
            type: 'boolean',
            description: 'Default false (non-blocking). True waits for the dialog.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_delete',
      description:
        'Delete a skill by id ONLY when the user explicitly asks to delete it. Do not call proactively. Opens a confirm dialog. Cannot defer to 待确认. Default wait=false; set wait=true to block until the user decides.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill id to delete' },
          wait: {
            type: 'boolean',
            description: 'Default false (non-blocking). True waits for confirm/cancel.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_export',
      description:
        'Export a skill ONLY when the user explicitly asks to export it. Do not call proactively. Preview dialog then save-file. Cannot defer to 待确认. Default wait=false; set wait=true to block until the user confirms or cancels.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill id to export' },
          wait: {
            type: 'boolean',
            description: 'Default false (non-blocking). True waits for dialog.',
          },
        },
        required: ['id'],
      },
    },
  },
]

/** Exposed only when plugins.dev_mode is enabled. */
export const PLUGIN_DEV_TOOL_NAMES = new Set([
  'plugin_build',
  'plugin_pack',
  'plugin_check',
  'plugin_link',
])

// Keep the public exports stable while prompt policy evolves independently.
export { SYSTEM_PROMPT_BASE, SYSTEM_PROMPT, buildSystemPrompt } from './agent-prompt'
