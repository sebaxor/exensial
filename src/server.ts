import { createServer } from "node:http";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
createServer(createApp()).listen(port, () => console.log(`Exensial listening on http://localhost:${port}`));
