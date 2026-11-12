<script lang="ts">
  import { slide } from 'svelte/transition'
  import {
    EXTENSIONS,
    extensionState,
    type Extension,
    type NumberSetting,
  } from '../lib/extensions/registry'
  import { preferencesStore } from '../stores/preferences'

  function setNumber(ext: Extension, setting: NumberSetting, e: Event & { currentTarget: HTMLInputElement }) {
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
</script>

<div class="extensions">
  <header>
    <h1>Extensions</h1>
    <p class="lede">Extra features, off unless you want them. Turn one on and it shows up where it helps.</p>
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
            <p>{ext.description}</p>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              role="switch"
              checked={state.enabled}
              aria-label={`${ext.name} extension`}
              onchange={(e) => preferencesStore.setExtensionEnabled(ext.id, e.currentTarget.checked)}
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
                    onchange={(e) => preferencesStore.setExtensionSetting(ext.id, setting.key, e.currentTarget.value)}
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
          </div>
        {/if}
      </section>
    {/each}
  </div>

  <p class="footnote">Extensions are saved with your settings and follow you across devices.</p>
</div>

<style>
  .extensions {
    font-family: var(--font-ui, inherit);
  }
  header h1 {
    font-size: 1.6rem;
    margin: 0 0 0.5rem;
    color: var(--text);
  }
  .lede {
    margin: 0 0 1.75rem;
    color: var(--muted);
    font-size: 0.9rem;
    opacity: 0.85;
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
    margin: 0 0 0.25rem;
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
  .ext-text p {
    margin: 0;
    color: var(--muted);
    font-size: 0.875rem;
    opacity: 0.85;
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

  .footnote {
    margin: 1.5rem 0 0;
    font-size: 0.78rem;
    color: var(--muted);
    opacity: 0.6;
  }
</style>
