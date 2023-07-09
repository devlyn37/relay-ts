import express, { Application, NextFunction, Request, Response } from "express";
import {
  createRequestInput,
  hexWithPrefix,
  serializeWithBigInt,
  strictUUID,
} from "./TypesAndValidation";
import { ZodError } from "zod";
import { env } from "./env";
import { RequestMediator } from "./RequestMediator";

export function createServer(mediator: RequestMediator) {
  const app: Application = express();
  app.use(express.json());
  app.use(auth);

  app.post(
    "/key/:address/tx",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { chainId, to, value, data } = createRequestInput.parse(req.body);
        const address = hexWithPrefix.parse(req.params.address);

        const id = await mediator.start(chainId, to, address, value, data);
        return res.status(200).json({ id });
      } catch (error) {
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
        next(error);
      }
    }
  );

  app.use(error);
  return app;
}

function auth(req: Request, res: Response, next: NextFunction) {
  const { authorization } = req.headers;

  if (!authorization || authorization !== env.AUTH_HEADER) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

function error(error: any, req: Request, res: Response, _next: NextFunction) {
  console.error(error);

  if (error instanceof ZodError) {
    return res.status(400).json(error.format());
  }

  return res.status(500).send("Something broke!");
}
