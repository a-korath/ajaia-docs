import { createApp } from './src/app.js';

const port = process.env.PORT || 3000;
createApp().listen(port, () => console.log(`Ajaia Docs running at http://localhost:${port}`));
