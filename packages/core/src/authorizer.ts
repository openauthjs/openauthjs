import { Adapter, AdapterOptions } from "./adapter/adapter.js";
import { SubjectPayload, SubjectSchema } from "./session.js";
import { Hono } from "hono/tiny";
import { handle as awsHandle } from "hono/aws-lambda";
import { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export interface OnSuccessResponder<
  T extends { type: string; properties: any },
> {
  session<Type extends T["type"]>(
    type: Type,
    properties: Extract<T, { type: Type }>["properties"],
  ): Promise<Response>;
}

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

import {
  MissingParameterError,
  UnauthorizedClientError,
  UnknownProviderError,
  UnknownStateError,
} from "./error.js";
import { compactDecrypt, CompactEncrypt, SignJWT } from "jose";
import { Storage, StorageAdapter } from "./storage/storage.js";
import { keys } from "./keys.js";

export const aws = awsHandle;

export function authorizer<
  Providers extends Record<string, Adapter<any>>,
  Sessions extends SubjectSchema,
  Result = {
    [key in keyof Providers]: Prettify<
      {
        provider: key;
      } & (Providers[key] extends Adapter<infer T> ? T : {})
    >;
  }[keyof Providers],
>(input: {
  subjects: Sessions;
  storage: StorageAdapter;
  providers: Providers;
  ttl?: {
    access?: number;
    refresh?: number;
  };
  start?(req: Request): Promise<void>;
  success(
    response: OnSuccessResponder<SubjectPayload<Sessions>>,
    input: Result,
    req: Request,
  ): Promise<Response>;
  error?(
    error:
      | MissingParameterError
      | UnauthorizedClientError
      | UnknownProviderError,
    req: Request,
  ): Promise<Response>;
  allow(
    clientID: string,
    audience: string | undefined,
    redirect: string,
    req: Request,
  ): Promise<boolean>;
}) {
  if (!input.error) {
    input.error = async (err) => {
      return new Response(err.message, {
        status: 400,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    };
  }

  const ttlAccess = input.ttl?.access ?? 60 * 60 * 24 * 30;
  const ttlRefresh = input.ttl?.refresh ?? 60 * 60 * 24 * 365;

  const allKeys = keys(input.storage);
  const primaryKey = allKeys.then((all) => all[0]);

  const auth: Omit<AdapterOptions<any>, "name"> = {
    async success(ctx: Context, properties: any) {
      const authorization =
        ctx.get("authorization") || (await auth.get(ctx, "authorization"));
      if (!authorization || !authorization.redirect_uri) {
        return auth.forward(
          ctx,
          await input.error!(new UnknownStateError(), ctx.req.raw),
        );
      }
      return await input.success(
        {
          async session(type, properties) {
            const authorization =
              ctx.get("authorization") ||
              (await auth.get(ctx, "authorization"));
            auth.unset(ctx, "authorization");
            if (authorization.response_type === "token") {
              const location = new URL(authorization.redirect_uri);
              const tokens = await generateTokens(ctx, {
                type: type as string,
                properties,
                clientID: authorization.client_id,
              });
              location.hash = new URLSearchParams({
                access_token: tokens.access,
                refresh_token: tokens.refresh,
                state: authorization.state || "",
              }).toString();
              return ctx.redirect(location.toString(), 302);
            }

            if (authorization.response_type === "code") {
              const code = crypto.randomUUID();
              await Storage.set(
                input.storage,
                ["oauth:code", code],
                {
                  type,
                  properties,
                  redirectURI: authorization.redirect_uri,
                  clientID: authorization.client_id,
                },
                Date.now() / 1000 + 60,
              );
              const location = new URL(authorization.redirect_uri);
              location.searchParams.set("code", code);
              location.searchParams.set("state", authorization.state || "");
              return ctx.redirect(location.toString(), 302);
            }
            return ctx.text(
              `Unsupported response_type: ${authorization.response_type}`,
              400,
            );
          },
        },
        {
          provider: ctx.get("provider"),
          ...properties,
        },
        ctx.req.raw,
      );
    },
    forward(ctx, response) {
      return ctx.newResponse(
        response.body,
        response.status as any,
        Object.fromEntries(response.headers.entries()),
      );
    },
    async set(ctx, key, maxAge, value) {
      setCookie(ctx, key, await encrypt(value), {
        maxAge,
        httpOnly: true,
        ...(ctx.req.url.startsWith("https://")
          ? { secure: true, sameSite: "None" }
          : {}),
      });
    },
    async get(ctx: Context, key: string) {
      const raw = getCookie(ctx, key);
      if (!raw) return;
      return decrypt(raw).catch(() => {});
    },
    async unset(ctx: Context, key: string) {
      deleteCookie(ctx, key);
    },
  };

  async function encrypt(value: any) {
    return await new CompactEncrypt(
      new TextEncoder().encode(JSON.stringify(value)),
    )
      .setProtectedHeader({ alg: "RSA-OAEP-512", enc: "A256GCM" })
      .encrypt(await primaryKey.then((k) => k.encryption.public));
  }

  async function resolveSubject(type: string, properties: any) {
    const jsonString = JSON.stringify(properties);
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonString);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${type}:${hashHex.slice(0, 16)}`;
  }

  async function generateTokens(
    ctx: Context,
    value: {
      type: string;
      properties: any;
      clientID: string;
    },
  ) {
    const subject = await resolveSubject(value.type, value.properties);
    const refreshToken = crypto.randomUUID();
    await Storage.set(
      input.storage,
      ["oauth:refresh", subject, refreshToken],
      {
        ...value,
      },
      Date.now() / 1000 + ttlRefresh,
    );
    return {
      access: await new SignJWT({
        mode: "access",
        type: value.type,
        properties: value.properties,
        audience: issuer(ctx),
        iss: issuer(ctx),
        sub: subject,
      })
        .setExpirationTime(Date.now() / 1000 + ttlAccess)
        .setProtectedHeader(
          await primaryKey.then((k) => ({
            alg: k.alg,
            kid: k.id,
            typ: "JWT",
          })),
        )
        .sign(await primaryKey.then((v) => v.signing.private)),
      refresh: [subject, refreshToken].join(":"),
    };
  }

  async function decrypt(value: string) {
    return JSON.parse(
      new TextDecoder().decode(
        await compactDecrypt(
          value,
          await primaryKey.then((v) => v.encryption.private),
        ).then((value) => value.plaintext),
      ),
    );
  }

  function issuer(ctx: Context) {
    const host =
      ctx.req.header("x-forwarded-host") ?? new URL(ctx.req.url).host;
    return `https://${host}`;
  }

  const app = new Hono<{
    Variables: {
      authorization: any;
    };
  }>();

  for (const [name, value] of Object.entries(input.providers)) {
    const route = new Hono<any>();
    route.use(async (c, next) => {
      c.set("provider", name);
      await next();
    });
    value(route, {
      name,
      ...auth,
    });
    app.route(`/${name}`, route);
  }

  app.get("/.well-known/jwks.json", async (c) => {
    const all = await allKeys;
    return c.json({
      keys: all.map((item) => item.jwk),
    });
  });

  app.get("/.well-known/oauth-authorization-server", async (c) => {
    const iss = issuer(c);
    return c.json({
      issuer: iss,
      authorization_endpoint: `${iss}/authorize`,
      token_endpoint: `${iss}/token`,
      jwks_uri: `${iss}/.well-known/jwks.json`,
      response_types_supported: ["code", "token"],
    });
  });

  app.post("/token", async (c) => {
    const form = await c.req.formData();
    const grantType = form.get("grant_type");

    if (grantType === "authorization_code") {
      const code = form.get("code");
      if (!code)
        return c.json(
          {
            error: "invalid_request",
            error_description: "Missing code",
          },
          400,
        );
      const key = ["oauth:code", code.toString()];
      const payload = await Storage.get<{
        type: string;
        properties: any;
        clientID: string;
        redirectURI: string;
      }>(input.storage, key);
      if (!payload) {
        return c.json(
          {
            error: "invalid_grant",
            error_description: "Authorization code has been used or expired",
          },
          400,
        );
      }
      await Storage.remove(input.storage, key);
      if (payload.redirectURI !== form.get("redirect_uri")) {
        return c.json(
          {
            error: "invalid_redirect_uri",
            error_description: "Redirect URI mismatch",
          },
          400,
        );
      }
      if (payload.clientID !== form.get("client_id")) {
        return c.json(
          {
            error: "unauthorized_client",
            error_description:
              "Client is not authorized to use this authorization code",
          },
          403,
        );
      }
      const tokens = await generateTokens(c, payload);
      return c.json({
        access_token: tokens.access,
        refresh_token: tokens.refresh,
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token");
      if (!refreshToken)
        return c.json(
          {
            error: "invalid_request",
            error_description: "Missing refresh_token",
          },
          400,
        );
      const splits = refreshToken.toString().split(":");
      const token = splits.pop()!;
      const subject = splits.join(":");
      const key = ["oauth:refresh", subject, token];
      const payload = await Storage.get<{
        type: string;
        properties: any;
        clientID: string;
      }>(input.storage, key);
      if (!payload) {
        return c.json(
          {
            error: "invalid_grant",
            error_description: "Refresh token has been used or expired",
          },
          400,
        );
      }
      await Storage.remove(input.storage, key);
      const tokens = await generateTokens(c, payload);
      return c.json({
        access_token: tokens.access,
        refresh_token: tokens.refresh,
      });
    }
  });

  app.get("/authorize", async (c) => {
    const provider = c.req.query("provider");
    if (!provider) return c.text("Missing provider", 400);
    let authorization = (await auth.get(c, "authorization")) || {};
    const response_type =
      c.req.query("response_type") || authorization.response_type;
    const redirect_uri =
      c.req.query("redirect_uri") || authorization.redirect_uri;
    const state = c.req.query("state") || authorization.state;
    const client_id = c.req.query("client_id") || authorization.client_id;
    const audience = c.req.query("audience") || authorization.audience;

    if (!provider) {
      c.status(400);
      return c.text("Missing provider");
    }

    if (!redirect_uri) {
      c.status(400);
      return c.text("Missing redirect_uri");
    }

    if (!response_type) {
      c.status(400);
      return c.text("Missing response_type");
    }

    if (!client_id) {
      c.status(400);
      return c.text("Missing client_id");
    }

    authorization = {
      provider,
      response_type,
      redirect_uri,
      state,
      client_id,
      audience,
    };
    await auth.set(c, "authorization", 60 * 10, authorization);
    c.set("authorization", authorization);

    if (input.start) {
      await input.start(c.req.raw);
    }

    return c.redirect(`/${provider}/authorize`);
  });

  app.all("/*", async (c) => {
    return c.notFound();
  });

  app.onError(async (err, c) => {
    if (
      err instanceof MissingParameterError ||
      err instanceof UnauthorizedClientError ||
      err instanceof UnknownProviderError
    ) {
      return auth.forward(c, await input.error(err, c.req.raw));
    }

    return c.text(err.message, 500);
  });

  return app;
}
