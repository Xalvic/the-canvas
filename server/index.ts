import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";

const config = loadServerConfig();
const server = createApp().listen(config.port, config.host, () => {
  console.log(`Scribble API: http://${config.host}:${config.port} (in-memory, local only)`);
});

server.on("error", (error) => {
  console.error("Could not start the API:", error.message);
  process.exitCode = 1;
});
