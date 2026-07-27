import { App } from './app/App';

document.addEventListener('DOMContentLoaded', () => {
  try {
    new App();
  } catch (err: any) {
    document.body.innerHTML = `
      <div style="padding:40px;color:#ef5350;font-family:monospace;">
        <h2>Failed to initialize MPCDI Viewer</h2>
        <pre>${err.message}</pre>
        <p>Ensure your browser supports WebGL2.</p>
      </div>
    `;
    console.error(err);
  }
});
