<script lang="ts">
  import { authStore } from '../../stores/auth'
  import { showError } from '../../stores/toast'

  let password = $state('')
  let submitting = $state(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!password.trim() || submitting) return
    submitting = true
    const ok = await authStore.login(password.trim())
    submitting = false
    if (!ok) {
      showError('Invalid password')
      password = ''
    }
  }

  function handleGuest(e: Event) {
    e.preventDefault()
    authStore.enterGuest()
  }
</script>

<div class="auth-container">
  <form class="auth-form" onsubmit={handleSubmit}>
    <div>
      <img src="/logo.svg" class="logo" alt="Hawk" />
    </div>
    <input
      name="password"
      placeholder="Type in the password"
      type="password"
      bind:value={password}
      required
    />
    <button type="submit" disabled={submitting}>
      {submitting ? '…' : 'Log in'}
    </button>
    <p>
      The correct password is needed to save the information, but you can go in and test it out.
    </p>
    <button type="button" class="guest" onclick={handleGuest}>Let me test it</button>
    <p>
      Author: <a href="https://pnetto.com" style="color: inherit;">Pedro Netto</a>
    </p>
  </form>
</div>

<style>
  .auth-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg);
    z-index: 2000;
  }
  .auth-form {
    width: min(15rem, 90vw);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
  }
  .auth-form .logo {
    width: 3rem;
    margin-bottom: 2rem;
  }
  .auth-form > :global(*) {
    display: block;
    border: 0;
    margin-bottom: 0.85rem;
    padding: 0.65rem 0.9rem;
    width: 100%;
    color: inherit;
    font-family: inherit;
  }
  .auth-form input {
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--line);
    transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .auth-form input:hover,
  .auth-form input:focus {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.08);
    outline: none;
  }
  .auth-form button {
    border-radius: 10px;
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-weight: 600;
    font-family: var(--font-ui, inherit);
    transition: filter var(--dur-fast) var(--ease-out);
  }
  .auth-form button:hover { filter: brightness(1.05); }
  .auth-form button:disabled { opacity: 0.6; cursor: default; }
  .guest {
    background: transparent !important;
    color: var(--muted) !important;
    text-decoration: none !important;
    font-size: 0.78rem;
    border: 0;
    cursor: pointer;
    font-weight: 400 !important;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .guest:hover {
    color: var(--accent) !important;
  }
  p {
    font-family: var(--font-ui, inherit);
    font-size: 0.78rem;
    opacity: 0.55;
    line-height: 1.5;
  }
</style>
