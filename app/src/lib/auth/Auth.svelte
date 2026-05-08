<script lang="ts">
  import { authStore } from '../../stores/auth'

  let password = $state('')
  let submitting = $state(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!password.trim() || submitting) return
    submitting = true
    const ok = await authStore.login(password.trim())
    submitting = false
    if (!ok) {
      console.warn('Invalid password, entering guest mode...')
      authStore.enterGuest()
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
    margin-bottom: 1rem;
    padding: 0.5rem;
    width: 100%;
    color: inherit;
  }
  .auth-form input,
  .auth-form button {
    border-radius: 10px;
    background: var(--input-bg);
  }
  .auth-form button {
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-weight: bold;
  }
  .guest {
    background: transparent !important;
    color: var(--accent) !important;
    text-decoration: underline;
    font-size: 0.8rem;
    border: 0;
    cursor: pointer;
    font-weight: normal !important;
  }
  p {
    font-size: 0.8rem;
    opacity: 0.6;
  }
</style>
