import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
new Server(httpServer);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const port = Number(process.env.PORT) || 3002;

httpServer.listen(port, () => {
  console.log(`Realtime service listening on port ${port}`);
});
