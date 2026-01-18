/**
 * Styles for the ZenMode component
 */
export const style = /* css */ `
.zen-mode {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg);
    z-index: 1000;
}

.quote-wrapper {
    position: absolute;
    right: 2rem;
    bottom: 2rem;
    text-align: right;
    width: 20rem;
}

.quote {
    font-size: 0.8rem;
    color: var(--glass);
    margin-bottom: 0.5rem;
}

.author {
    font-size: 0.7rem;
    color: var(--glass);
}
`;
