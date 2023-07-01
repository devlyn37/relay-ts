import express, { Application, NextFunction, Request, Response } from "express";
import {
  createRequestInput,
  hexWithPrefix,
  serializeWithBigInt,
  strictUUID,
} from "./TypesAndValidation";
import { ZodError } from "zod";
import { setup } from "./setup";

async function startServer(port: number) {
  const mediator = await setup();
  const app: Application = express();

  app.use(express.json());

  app.post(
    "/key/:address/tx",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { chainId, to, value, data } = createRequestInput.parse(req.body);
        const address = hexWithPrefix.parse(req.params.address);

        const id = await mediator.start(chainId, to, address, value, data);
        return res.status(200).json({ id });
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json(error.format());
        }

        next(error);
      }
    }
  );

  app.get(
    "/tx/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = strictUUID.parse(req.params.id);
        const request = await mediator.find(id);

        if (request === null) {
          return res.status(404).end();
        }
        return res.status(200).json(serializeWithBigInt(request));
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json(error.format());
        }

        next(error);
      }
    }
  );

  // Error handling middleware
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error(err.stack);
    res.status(500).send("Something broke!");
  });

  app.listen(port, () => {
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
