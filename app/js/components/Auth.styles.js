/**
 * Styles for the AuthOverlay component
 */
export const style = /* css */ `
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

.auth-form > * {
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
    background: var(--glass-dark);
}

.auth-form button {
    background: var(--accent);
    color: #000;
    cursor: pointer;
    font-weight: bold;
}

.guest {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.8rem;
}

p {
    font-size: 0.8rem;
    opacity: 0.6;
}

.hidden { display: none !important; }
`;
