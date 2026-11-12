<script lang="ts">
  import { slide } from 'svelte/transition'
  import {
    EXTENSIONS,
    extensionState,
    type Extension,
    type NumberSetting,
    type RangeSetting,
  } from '../lib/extensions/registry'
  import { preferencesStore } from '../stores/preferences'
  import {
    notificationsSupported,
    previewChime,
    requestNotificationPermission,
  } from '../stores/pomodoro'

  type NotifPermission = NotificationPermission | 'unsupported'

  function currentNotifPermission(): NotifPermission {
    return notificationsSupported() ? Notification.permission : 'unsupported'
  }

  let notifPermission = $state<NotifPermission>(currentNotifPermission())

  async function allowNotifications() {
    await requestNotificationPermission()
    notifPermission = currentNotifPermission()
  }

  function setNumber(ext: Extension, setting: NumberSetting | RangeSetting, e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget
    const value = Number(input.value)
    const current = extensionState($preferencesStore.extensions, ext.id).settings[setting.key]
    const fallback = typeof current === 'number' ? current : Number(ext.defaults[setting.key])
    const clamped = Number.isFinite(value)
      ? Math.min(setting.max, Math.max(setting.min, Math.round(value)))
      : fallback
    // Keep the field honest after clamping ("3" with a 5 min minimum).
    input.value = String(clamped)
    if (clamped !== current) preferencesStore.setExtensionSetting(ext.id, setting.key, clamped)
  }

  function setRange(ext: Extension, setting: RangeSetting, e: Event & { currentTarget: HTMLInputElement }) {
    const value = Number(e.currentTarget.value)
    if (Number.isFinite(value)) preferencesStore.setExtensionSetting(ext.id, setting.key, value)
  }
</script>

<div class="extensions">
  <header>
    <h1>Extensions</h1>
  </header>

  <div class="list">
    {#each EXTENSIONS as ext (ext.id)}
      {@const state = extensionState($preferencesStore.extensions, ext.id)}
      <section class="ext" class:on={state.enabled}>
        <div class="ext-head">
          <div class="ext-text">
            <h2>
              {ext.name}
              <span class="where">{ext.where}</span>
            </h2>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              role="switch"
              checked={state.enabled}
              aria-label={`${ext.name} extension`}
              onchange={async (e) => {
                const enabled = e.currentTarget.checked
                preferencesStore.setExtensionEnabled(ext.id, enabled)
                // The timer reports finished blocks from the background, which
                // needs the browser's permission first.
                if (enabled && ext.id === 'pomodoro') {
                  await requestNotificationPermission()
                  notifPermission = currentNotifPermission()
                }
              }}
            />
            <span class="track" aria-hidden="true"><span class="knob"></span></span>
            <span class="switch-label">{state.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        {#if state.enabled && ext.settings.length}
          <div class="settings" transition:slide={{ duration: 180 }}>
            {#each ext.settings.filter((s) => !s.hideWhen || state.settings[s.hideWhen.key] !== s.hideWhen.equals) as setting (setting.key)}
              {#if setting.kind === 'number'}
                <label class="setting">
                  <span class="setting-text">
                    <span class="setting-label">{setting.label}</span>
                    {#if setting.help}<span class="setting-help">{setting.help}</span>{/if}
                  </span>
                  <span class="number-field">
                    <input
                      type="number"
                      min={setting.min}
                      max={setting.max}
                      step={setting.step}
                      value={state.settings[setting.key]}
                      aria-label={setting.label}
                      onchange={(e) => setNumber(ext, setting, e)}
                    />
                    {#if setting.unit}<span class="unit">{setting.unit}</span>{/if}
                  </span>
                </label>
              {:else if setting.kind === 'range'}
                <label class="setting">
                  <span class="setting-text">
                    <span class="setting-label">{setting.label}</span>
                    {#if setting.help}<span class="setting-help">{setting.help}</span>{/if}
                  </span>
                  <span class="range-field">
                    <input
                      type="range"
                      min={setting.min}
                      max={setting.max}
                      step={setting.step}
                      value={Number(state.settings[setting.key])}
                      aria-label={setting.label}
                      oninput={(e) => setRange(ext, setting, e)}
                    />
                    <span class="range-value">{state.settings[setting.key]}{setting.unit}</span>
                  </span>
                </label>
              {:else if setting.kind === 'select'}
                <label class="setting">
                  <span class="setting-text">
                    <span class="setting-label">{setting.label}</span>
                    {#if setting.help}<span class="setting-help">{setting.help}</span>{/if}
                  </span>
                  <select
                    class="select-field"
                    aria-label={setting.label}
                    value={state.settings[setting.key]}
                    onchange={(e) => {
                      preferencesStore.setExtensionSetting(ext.id, setting.key, e.currentTarget.value)
                      // Play the pick so the choices can be compared by ear.
                      previewChime()
                    }}
                  >
                    {#each setting.options as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </label>
              {:else}
                <label class="setting">
                  <span class="setting-text">
                    <span class="setting-label">{setting.label}</span>
                    {#if setting.help}<span class="setting-help">{setting.help}</span>{/if}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    class="mini-switch"
                    checked={state.settings[setting.key] === true}
                    aria-label={setting.label}
                    onchange={(e) => preferencesStore.setExtensionSetting(ext.id, setting.key, e.currentTarget.checked)}
                  />
                </label>
              {/if}
            {/each}
            {#if ext.id === 'pomodoro'}
              <div class="settings-foot">
                <span class="notif-hint">
                  {#if notifPermission === 'denied'}
                    Notifications are blocked in your browser settings.
                  {/if}
                </span>
                {#if notifPermission === 'default'}
                  <button type="button" class="btn-secondary test-sound" onclick={allowNotifications}>
                    Turn on notifications
                  </button>
                {/if}
                <button
                  type="button"
                  class="btn-secondary test-sound"
                  disabled={state.settings.chime === 'off'}
                  onclick={() => previewChime()}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 6h2l3.5-2.5v9L5 10H3z" fill="currentColor" />
                    <path d="M10.5 6.2a2.5 2.5 0 0 1 0 3.6" />
                    <path d="M12.3 4.4a5 5 0 0 1 0 7.2" />
                  </svg>
                  Play
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .extensions {
    font-family: var(--font-ui, inherit);
  }
  header h1 {
    font-size: 1.6rem;
    margin: 0 0 1.5rem;
    color: var(--text);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .ext {
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .ext.on { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
  .ext-head {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.9rem 1rem;
  }
  .ext-text { flex: 1; min-width: 0; }
  .ext-text h2 {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }
  .where {
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.65;
  }

  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--muted);
    cursor: pointer;
    user-select: none;
  }
  .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .switch .track {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 999px;
    background: var(--glass);
    border: 1px solid var(--line);
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .switch .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .switch input:checked + .track { background: var(--accent); border-color: var(--accent); }
  .switch input:checked + .track .knob { transform: translateX(12px); background: var(--on-accent); }
  .switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
  .switch:hover { color: var(--text); }
  .switch input:checked ~ .switch-label { color: var(--accent); }

  .settings {
    display: flex;
    flex-direction: column;
    margin: 0 1rem;
    border-top: 1px solid var(--line);
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0;
    cursor: pointer;
  }
  .setting + .setting { border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .setting-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
  .setting-label { font-size: 0.85rem; color: var(--text); }
  .setting-help { font-size: 0.78rem; color: var(--muted); opacity: 0.75; }

  .number-field {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  .number-field input {
    width: 4.5rem;
    height: var(--h-md);
    padding: 0 0.5rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--input-bg);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .number-field input:focus { border-color: var(--accent); outline: none; }
  .unit {
    width: 1.9rem;
    font-size: 0.75rem;
    color: var(--muted);
    opacity: 0.75;
  }

  .mini-switch {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .select-field {
    flex-shrink: 0;
    height: var(--h-md);
    padding: 0 0.4rem;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--input-bg);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .select-field:focus { border-color: var(--accent); outline: none; }

  .range-field {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
    width: 11rem;
  }
  .range-field input {
    flex: 1;
    min-width: 0;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .range-value {
    width: 2.4rem;
    text-align: right;
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .settings-foot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: flex-end;
    padding: 0.25rem 0 0.85rem;
  }
  .notif-hint {
    margin-right: auto;
    font-size: 0.78rem;
    color: var(--muted);
    opacity: 0.85;
  }
  .test-sound {
    gap: 0.35rem;
    font-size: 0.8rem;
  }
  .test-sound :global(svg) { width: 14px; height: 14px; }
</style>
