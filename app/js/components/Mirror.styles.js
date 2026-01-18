/**
 * Styles for the MirrorMode component
 */
export const style = /* css */ `
.mirror {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--bg);
    z-index: 1000;
}

.mirror video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.mirror .looking-good {
    position: absolute;
    top: 6rem;
    right: 3rem;
    transform: rotate(30deg);
    background: #4d0c66;
    padding: 2rem;
    border-radius: 10px;
    font-size: 2rem;
    color: white;
}

.hidden { display: none !important; }
`;
