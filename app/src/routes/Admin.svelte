<script lang="ts">
  import { THEMES } from '../lib/themes/themes'
  import ThemeCard from '../lib/themes/ThemeCard.svelte'
</script>

<div class="admin">
  <header>
    <h1>Settings</h1>
  </header>

  <section class="appearance">
    <div class="section-head">
      <h2>Appearance</h2>
      <p>Pick a theme. Changes apply instantly and follow you across devices.</p>
    </div>

    <div class="grid">
      {#each THEMES as theme (theme.id)}
        <ThemeCard {theme} />
      {/each}
    </div>
  </section>

  <!-- future settings sections live here -->
</div>

<style>
  .admin {
    font-family: var(--font-ui, inherit);
  }
  header h1 {
    font-size: 1.6rem;
    margin: 0 0 1.5rem;
    color: var(--text);
  }
  .section-head {
    margin-bottom: 1.25rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--line);
  }
  .section-head h2 {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--muted);
    margin: 0 0 0.35rem;
    font-weight: 600;
  }
  .section-head p {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
    opacity: 0.85;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.75rem;
    }
  }
</style>
