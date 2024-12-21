import { Adapter, AdapterOptions } from "./adapter/adapter.js"
import { SubjectPayload, SubjectSchema } from "./session.js"
import { Hono } from "hono/tiny"
import { handle as awsHandle } from "hono/aws-lambda"
import { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

/**
 * The interface for the success responder.
 */
export interface OnSuccessResponder<
  T extends { type: string; properties: any },
> {
  subject<Type extends T["type"]>(
    type: Type,
    properties: Extract<T, { type: Type }>["properties"],
    opts?: {
      ttl?: {
        access?: number
        refresh?: number
      }
    },
  ): Promise<Response>
}

interface AuthorizationState {
  redirect_uri: string
  response_type: string
  state: string
  client_id: string
  audience?: string
  pkce?: {
    challenge: string
    method: "S256"
  }
}

export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

import {
  MissingParameterError,
  OauthError,
  UnauthorizedClientError,
  UnknownStateError,
} from "./error.js"
import { compactDecrypt, CompactEncrypt, SignJWT } from "jose"
import { Storage, StorageAdapter } from "./storage/storage.js"
import { keys } from "./keys.js"
import { validatePKCE } from "./pkce.js"
import { Select } from "./ui/select.js"
import { setTheme, Theme } from "./ui/theme.js"
import { isDomainMatch } from "./util.js"
import { DynamoStorage } from "./storage/dynamo.js"
import { MemoryStorage } from "./storage/memory.js"
import { cors } from "hono/cors"

/** @internal */
export const aws = awsHandle

export interface AuthorizerInput<
  Providers extends Record<string, Adapter<any>>,
  Subjects extends SubjectSchema,
  Result = {
    [key in keyof Providers]: Prettify<
      {
        provider: key
      } & (Providers[key] extends Adapter<infer T> ? T : {})
    >
  }[keyof Providers],
> {
  subjects: Subjects
  storage?: StorageAdapter
  providers: Providers
  theme?: Theme
  ttl?: {
    access?: number
    refresh?: number
  }
  select?(providers: Record<string, string>, req: Request): Promise<Response>
  start?(req: Request): Promise<void>
  success(
    response: OnSuccessResponder<SubjectPayload<Subjects>>,
    input: Result,
    req: Request,
  ): Promise<Response>
  error?(error: UnknownStateError, req: Request): Promise<Response>
  allow?(
    input: {
      clientID: string
      redirectURI: string
      audience?: string
    },
    req: Request,
  ): Promise<boolean>
}

/**
 * Create an authorizer object for handling OAuth 2.0 authorization requests.
 * @param input - The input object containing the subjects, storage, providers, theme, and optional success responder.
 * @returns An object containing methods for authorizing, exchanging tokens, refreshing tokens, and verifying tokens.
 */
export function authorizer<
  Providers extends Record<string, Adapter<any>>,
  Subjects extends SubjectSchema,
  Result = {
    [key in keyof Providers]: Prettify<
      {
        provider: key
      } & (Providers[key] extends Adapter<infer T> ? T : {})
    >
  }[keyof Providers],
>(input: AuthorizerInput<Providers, Subjects, Result>) {
  const error =
    input.error ??
    function (err) {
      return new Response(err.message, {
        status: 400,
        headers: {
          "Content-Type": "text/plain",
        },
      })
    }
  const ttlAccess = input.ttl?.access ?? 60 * 60 * 24 * 30
  const ttlRefresh = input.ttl?.refresh ?? 60 * 60 * 24 * 365
  if (input.theme) {
    setTheme(input.theme)
  }

  const select = input.select ?? Select()
  const allow =
    input.allow ??
    (async (input, req) => {
      const redir = new URL(input.redirectURI).hostname
      if (redir === "localhost" || redir === "127.0.0.1") {
        return true
      }
      const forwarded = req.headers.get("x-forwarded-host")
      const host = forwarded
        ? new URL(`https://` + forwarded).hostname
        : new URL(req.url).hostname

      return isDomainMatch(redir, host)
    })

  let storage = input.storage
  if (process.env.OPENAUTH_STORAGE) {
    const parsed = JSON.parse(process.env.OPENAUTH_STORAGE)
    if (parsed.type === "dynamo") storage = DynamoStorage(parsed.options)
    if (parsed.type === "memory") storage = MemoryStorage()
    if (parsed.type === "cloudflare")
      throw new Error(
        "Cloudflare storage cannot be configured through env because it requires bindings.",
      )
  }
  if (!storage)
    throw new Error(
      "Store is not configured. Either set the `storage` option or set `OPENAUTH_STORAGE` environment variable.",
    )
  const allKeys = keys(storage)
  const primaryKey = allKeys.then((all) => all[0])

  const auth: Omit<AdapterOptions<any>, "name"> = {
    async success(ctx: Context, properties: any, successOpts) {
      return await input.success(
        {
          async subject(type, properties, subjectOpts) {
            const authorization = await getAuthorization(ctx)
            await successOpts?.invalidate?.(
              await resolveSubject(type, properties),
            )
            if (authorization.response_type === "token") {
              const location = new URL(authorization.redirect_uri)
              const tokens = await generateTokens(ctx, {
                type: type as string,
                properties,
                clientID: authorization.client_id,
                ttl: {
                  access: subjectOpts?.ttl?.access ?? ttlAccess,
                  refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh,
                },
              })
              location.hash = new URLSearchParams({
                access_token: tokens.access,
                refresh_token: tokens.refresh,
                state: authorization.state || "",
              }).toString()
              await auth.unset(ctx, "authorization")
              return ctx.redirect(location.toString(), 302)
            }
            if (authorization.response_type === "code") {
              const code = crypto.randomUUID()
              await Storage.set(
                storage,
                ["oauth:code", code],
                {
                  type,
                  properties,
                  redirectURI: authorization.redirect_uri,
                  clientID: authorization.client_id,
                  pkce: authorization.pkce,
                  ttl: {
                    access: subjectOpts?.ttl?.access ?? ttlAccess,
                    refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh,
                  },
                },
                60,
              )
              const location = new URL(authorization.redirect_uri)
              location.searchParams.set("code", code)
              location.searchParams.set("state", authorization.state || "")
              await auth.unset(ctx, "authorization")
              return ctx.redirect(location.toString(), 302)
            }
            throw new OauthError(
              "invalid_request",
              `Unsupported response_type: ${authorization.response_type}`,
            )
          },
        },
        {
          provider: ctx.get("provider"),
          ...properties,
        },
        ctx.req.raw,
      )
    },
    forward(ctx, response) {
      return ctx.newResponse(
        response.body,
        response.status as any,
        Object.fromEntries(response.headers.entries()),
      )
    },
    async set(ctx, key, maxAge, value) {
      setCookie(ctx, key, await encrypt(value), {
        maxAge,
        httpOnly: true,
        ...(ctx.req.url.startsWith("https://")
          ? { secure: true, sameSite: "None" }
          : {}),
      })
    },
    async get(ctx: Context, key: string) {
      const raw = getCookie(ctx, key)
      if (!raw) return
      return decrypt(raw).catch((ex) => {
        console.error("failed to decrypt", key, ex)
      })
    },
    async unset(ctx: Context, key: string) {
      deleteCookie(ctx, key)
    },
    async invalidate(subject: string) {
      for await (const [key] of Storage.scan(this.storage, [
        "oauth:refresh",
        subject,
      ])) {
        await Storage.remove(this.storage, key)
      }
    },
    storage,
  }

  async function getAuthorization(ctx: Context) {
    const match =
      (await auth.get(ctx, "authorization")) || ctx.get("authorization")
    if (!match) throw new UnknownStateError()
    return match as AuthorizationState
  }

  async function encrypt(value: any) {
    return await new CompactEncrypt(
      new TextEncoder().encode(JSON.stringify(value)),
    )
      .setProtectedHeader({ alg: "RSA-OAEP-512", enc: "A256GCM" })
      .encrypt(await primaryKey.then((k) => k.encryption.public))
  }

  async function resolveSubject(type: string, properties: any) {
    const jsonString = JSON.stringify(properties)
    const encoder = new TextEncoder()
    const data = encoder.encode(jsonString)
    const hashBuffer = await crypto.subtle.digest("SHA-1", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    return `${type}:${hashHex.slice(0, 16)}`
  }

  async function generateTokens(
    ctx: Context,
    value: {
      type: string
      properties: any
      clientID: string
      ttl: {
        access: number
        refresh: number
      }
    },
  ) {
    const subject = await resolveSubject(value.type, value.properties)
    const refreshToken = crypto.randomUUID()
    await Storage.set(
      storage!,
      ["oauth:refresh", subject, refreshToken],
      {
        ...value,
      },
      value.ttl.refresh,
    )
    return {
      access: await new SignJWT({
        mode: "access",
        type: value.type,
        properties: value.properties,
        aud: value.clientID,
        iss: issuer(ctx),
        sub: subject,
      })
        .setExpirationTime(Date.now() / 1000 + value.ttl.access)
        .setProtectedHeader(
          await primaryKey.then((k) => ({
            alg: k.alg,
            kid: k.id,
            typ: "JWT",
          })),
        )
        .sign(await primaryKey.then((v) => v.signing.private)),
      refresh: [subject, refreshToken].join(":"),
    }
  }

  async function decrypt(value: string) {
    return JSON.parse(
      new TextDecoder().decode(
        await compactDecrypt(
          value,
          await primaryKey.then((v) => v.encryption.private),
        ).then((value) => value.plaintext),
      ),
    )
  }

  function issuer(ctx: Context) {
    const url = new URL(ctx.req.url)
    const host = ctx.req.header("x-forwarded-host") ?? url.host
    return url.protocol + "//" + host
  }

  const app = new Hono<{
    Variables: {
      authorization: AuthorizationState
    }
  }>()

  for (const [name, value] of Object.entries(input.providers)) {
    const route = new Hono<any>()
    route.use(async (c, next) => {
      c.set("provider", name)
      await next()
    })
    value.init(route, {
      name,
      ...auth,
    })
    app.route(`/${name}`, route)
  }

  app.get("/.well-known/jwks.json", async (c) => {
    const all = await allKeys
    return c.json({
      keys: all.map((item) => item.jwk),
    })
  })

  app.get("/.well-known/oauth-authorization-server", async (c) => {
    const iss = issuer(c)
    return c.json({
      issuer: iss,
      authorization_endpoint: `${iss}/authorize`,
      token_endpoint: `${iss}/token`,
      jwks_uri: `${iss}/.well-known/jwks.json`,
      response_types_supported: ["code", "token"],
    })
  })

  app.post(
    "/token",
    cors({
      origin: "*",
      allowHeaders: ["*"],
      allowMethods: ["POST"],
      credentials: false,
    }),
    async (c) => {
      const form = await c.req.formData()
      const grantType = form.get("grant_type")

      if (grantType === "authorization_code") {
        const code = form.get("code")
        if (!code)
          return c.json(
            {
              error: "invalid_request",
              error_description: "Missing code",
            },
            400,
          )
        const key = ["oauth:code", code.toString()]
        const payload = await Storage.get<{
          type: string
          properties: any
          clientID: string
          redirectURI: string
          ttl: {
            access: number
            refresh: number
          }
          pkce?: AuthorizationState["pkce"]
        }>(storage, key)
        if (!payload) {
          return c.json(
            {
              error: "invalid_grant",
              error_description: "Authorization code has been used or expired",
            },
            400,
          )
        }
        await Storage.remove(storage, key)
        if (payload.redirectURI !== form.get("redirect_uri")) {
          return c.json(
            {
              error: "invalid_redirect_uri",
              error_description: "Redirect URI mismatch",
            },
            400,
          )
        }
        if (payload.clientID !== form.get("client_id")) {
          return c.json(
            {
              error: "unauthorized_client",
              error_description:
                "Client is not authorized to use this authorization code",
            },
            403,
          )
        }

        if (payload.pkce) {
          const codeVerifier = form.get("code_verifier")?.toString()
          if (!codeVerifier)
            return c.json(
              {
                error: "invalid_grant",
                error_description: "Missing code_verifier",
              },
              400,
            )

          if (
            !(await validatePKCE(
              codeVerifier,
              payload.pkce.challenge,
              payload.pkce.method,
            ))
          ) {
            return c.json(
              {
                error: "invalid_grant",
                error_description: "Code verifier does not match",
              },
              400,
            )
          }
        }
        const tokens = await generateTokens(c, payload)
        return c.json({
          access_token: tokens.access,
          refresh_token: tokens.refresh,
        })
      }

      if (grantType === "refresh_token") {
        const refreshToken = form.get("refresh_token")
        if (!refreshToken)
          return c.json(
            {
              error: "invalid_request",
              error_description: "Missing refresh_token",
            },
            400,
          )
        const splits = refreshToken.toString().split(":")
        const token = splits.pop()!
        const subject = splits.join(":")
        const key = ["oauth:refresh", subject, token]
        const payload = await Storage.get<{
          type: string
          properties: any
          clientID: string
          ttl: {
            access: number
            refresh: number
          }
        }>(storage, key)
        if (!payload) {
          return c.json(
            {
              error: "invalid_grant",
              error_description: "Refresh token has been used or expired",
            },
            400,
          )
        }
        await Storage.remove(storage, key)
        const tokens = await generateTokens(c, payload)
        return c.json({
          access_token: tokens.access,
          refresh_token: tokens.refresh,
        })
      }

      if (grantType === "client_credentials") {
        const provider = form.get("provider")
        if (!provider)
          return c.json({ error: "missing `provider` form value" }, 400)
        const match = input.providers[provider.toString()]
        if (!match)
          return c.json({ error: "invalid `provider` query parameter" }, 400)
        if (!match.client)
          return c.json(
            { error: "this provider does not support client_credentials" },
            400,
          )
        const clientID = form.get("client_id")
        const clientSecret = form.get("client_secret")
        if (!clientID)
          return c.json({ error: "missing `client_id` form value" }, 400)
        if (!clientSecret)
          return c.json({ error: "missing `client_secret` form value" }, 400)
        const response = await match.client({
          clientID: clientID.toString(),
          clientSecret: clientSecret.toString(),
          params: Object.fromEntries(form) as Record<string, string>,
        })
        return input.success(
          {
            async subject(type, properties, opts) {
              const tokens = await generateTokens(c, {
                type: type as string,
                properties,
                clientID: clientID.toString(),
                ttl: {
                  access: opts?.ttl?.access ?? ttlAccess,
                  refresh: opts?.ttl?.refresh ?? ttlRefresh,
                },
              })
              return c.json({
                access_token: tokens.access,
                refresh_token: tokens.refresh,
              })
            },
          },
          {
            provider: provider.toString(),
            ...response,
          },
          c.req.raw,
        )
      }

      throw new Error("Invalid grant_type")
    },
  )

  app.post(
    "/revoke",
    cors({
      origin: "*",
      allowHeaders: ["*"],
      allowMethods: ["POST"],
      credentials: false,
    }),
    async (c) => {
      const form = await c.req.formData()

      const refreshToken = form.get("token")
      if (!refreshToken)
        return c.json(
          {
            error: "invalid_request",
            error_description: "Missing refresh_token",
          },
          400,
        )
      const splits = refreshToken.toString().split(":")
      const token = splits.pop()!
      const subject = splits.join(":")
      const key = ["oauth:refresh", subject, token]
      const payload = await Storage.get<{
        type: string
        properties: any
        clientID: string
        ttl: {
          access: number
          refresh: number
        }
      }>(storage, key)
      if (!payload) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "Refresh token not found or expired",
          },
          400,
        )
      }
      await Storage.remove(storage, key)

      const all = form.get("revoke_all") === "true"
      if (all) {
        for await (const [key] of Storage.scan(storage, [
          "oauth:refresh",
          subject,
        ])) {
          await Storage.remove(storage, key)
        }
      }

      return c.newResponse(null, 200)
    },
  )

  app.get("/authorize", async (c) => {
    const provider = c.req.query("provider")
    const response_type = c.req.query("response_type")
    const redirect_uri = c.req.query("redirect_uri")
    const state = c.req.query("state")
    const client_id = c.req.query("client_id")
    const audience = c.req.query("audience")
    const code_challenge = c.req.query("code_challenge")
    const code_challenge_method = c.req.query("code_challenge_method")
    const authorization: AuthorizationState = {
      response_type,
      redirect_uri,
      state,
      client_id,
      audience,
      pkce:
        code_challenge && code_challenge_method
          ? {
              challenge: code_challenge,
              method: code_challenge_method,
            }
          : undefined,
    } as AuthorizationState
    c.set("authorization", authorization)

    if (!redirect_uri) {
      return c.text("Missing redirect_uri", { status: 400 })
    }

    if (!response_type) {
      throw new MissingParameterError("response_type")
    }

    if (!client_id) {
      throw new MissingParameterError("client_id")
    }

    if (input.start) {
      await input.start(c.req.raw)
    }

    if (
      !(await allow(
        {
          clientID: client_id,
          redirectURI: redirect_uri,
          audience,
        },
        c.req.raw,
      ))
    )
      throw new UnauthorizedClientError(client_id, redirect_uri)
    await auth.set(c, "authorization", 60 * 60 * 24, authorization)
    if (provider) return c.redirect(`/${provider}/authorize`)
    const providers = Object.keys(input.providers)
    if (providers.length === 1) return c.redirect(`/${providers[0]}/authorize`)
    return auth.forward(
      c,
      await select(
        Object.fromEntries(
          Object.entries(input.providers).map(([key, value]) => [
            key,
            value.type,
          ]),
        ),
        c.req.raw,
      ),
    )
  })

  app.all("/*", async (c) => {
    return c.notFound()
  })

  app.onError(async (err, c) => {
    console.error(err)
    if (err instanceof UnknownStateError) {
      return auth.forward(c, await error(err, c.req.raw))
    }
    const authorization = await getAuthorization(c)
    const url = new URL(authorization.redirect_uri)
    const oauth =
      err instanceof OauthError
        ? err
        : new OauthError("server_error", err.message)
    url.searchParams.set("error", oauth.error)
    url.searchParams.set("error_description", oauth.description)
    return c.redirect(url.toString())
  })

  return app
}
