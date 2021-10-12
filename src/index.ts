import { Request, Response } from "express";
import {
  DocumentNode,
  GraphQLError,
  GraphQLSchema,
  parse,
  validate,
  validateSchema,
} from "graphql";
import { CompiledQuery, compileQuery } from "graphql-jit";
import LRU from "tiny-lru";
import { isEnumerableObject } from "./isEnumerableObject";

interface ExpressParams {
  req: Request;
  res: Response;
}

interface FormatErrorParams extends ExpressParams {
  error: GraphQLError;
}

interface Options {
  schema: GraphQLSchema;
  context?: (x: ExpressParams) => any | Promise<any>;
  formatError?: (x: FormatErrorParams) => GraphQLError;
}

interface ErrorCacheValue {
  document: DocumentNode;
  validationErrors: readonly GraphQLError[];
}

interface CacheValue extends ErrorCacheValue {
  jit: CompiledQuery;
}

export const createGraphqlMiddleware = ({
  schema,
  context,
  formatError,
}: Options) => {
  const lru = LRU<CacheValue>(1024);
  const lruErrors = LRU<ErrorCacheValue>(1024);

  const schemaValidationErrors = validateSchema(schema);
  if (schemaValidationErrors.length > 0) {
    throw schemaValidationErrors;
  }

  return async (req: Request, res: Response) => {
    // adapted from https://github.com/jaydenseric/graphql-api-koa/blob/master/lib/execute.js#L105
    if (typeof req.body === "undefined") {
      return res.status(400).send("Request body missing.");
    }

    if (!isEnumerableObject(req.body)) {
      return res.status(400).send("Request body must be a JSON object.");
    }

    if (!("query" in req.body)) {
      return res.status(400).send("GraphQL operation field `query` missing.");
    }

    if ("variables" in req.body && !isEnumerableObject(req.body.variables)) {
      return res
        .status(400)
        .send("Request body JSON `variables` field must be an object.");
    }

    if (
      typeof req.body.operationName !== "string" &&
      typeof req.body.operationName !== "undefined" &&
      req.body.operationName !== null
    ) {
      return res
        .status(400)
        .send(
          "Request body JSON `operationName` field must be an string/null/undefined."
        );
    }

    const { query } = req.body;

    // adapted from https://github.com/mcollina/fastify-gql/blob/master/index.js#L206
    let cached = lru.get(query);
    let document = null;

    if (!cached) {
      // We use two caches to avoid errors bust the good
      // cache. This is a protection against DoS attacks
      const cachedError = lruErrors.get(query);

      if (cachedError) {
        return res.status(400).send(cachedError.validationErrors);
      }

      try {
        document = parse(query);
      } catch (error) {
        return res
          .status(400)
          .send(`GraphQL query syntax error: ${error.message}`);
      }

      const validationErrors = validate(schema, document);

      if (validationErrors.length > 0) {
        lruErrors.set(query, { document, validationErrors });
        return res.status(400).send({
          errors: validationErrors,
        });
      }

      cached = {
        document,
        validationErrors,
        jit: compileQuery(
          schema,
          document,
          req.body.operationName
        ) as CompiledQuery,
      };

      lru.set(query, cached);
    }

    const result = await cached.jit.query(
      {},
      context ? await context({ req, res }) : {},
      req.body.variables
    );

    if (result.errors && formatError) {
      result.errors = result.errors.map((error) =>
        formatError({ req, res, error })
      );
    }

    return res.json(result);
  };
};
