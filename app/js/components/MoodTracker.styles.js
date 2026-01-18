/**
 * Styles for the MoodTracker component
 */
export const style = /* css */ `
.mood-tracker {
  display: flex;
  align-items: center;
  font-size: 1.5rem;  
  height: 2rem;
}

.mood-tracker .selected { cursor: pointer; }

.mood-tracker .options-container { display: flex; }

.mood-tracker .options .item {
  cursor: pointer;
  padding: 0 0.2rem;
  transition: transform 0.2s ease;
}

.mood-tracker .options .item:hover { transform: scale(1.2); }

.hidden { display: none !important; }

.logo {
    width: 2rem;
    height: 2rem;
}
`;
