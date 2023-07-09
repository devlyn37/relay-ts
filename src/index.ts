import { createServer } from "./server";
import { setupMonitoring } from "./setup";

async function startServer(port: number) {
  const mediator = await setupMonitoring();
  const server = createServer(mediator);

  server.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
}

process.on("uncaughtException", (err) => {
  console.error("There was an uncaught error", err);
  // process.exit(1); //mandatory (as per the Node.js docs)
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // process.exit(1); //mandatory (as per the Node.js docs)
});

startServer(3001).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
