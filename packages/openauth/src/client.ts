import {
  createLocalJWKSet,
  errors,
  JSONWebKeySet,
  jwtVerify,
  decodeJwt,
} from "jose"
import { SubjectSchema } from "./session.js"
import type { v1 } from "@standard-schema/spec"
import {
  InvalidAccessTokenError,
  InvalidAuthorizationCodeError,
  InvalidRefreshTokenError,
  InvalidSubjectError,
} from "./error.js"
import { generatePKCE } from "./pkce.js"

/**
 * The well-known information for an OAuth 2.0 authorization server.
 */
export interface WellKnown {
  /**
   * The URI to the JWKS endpoint.
   */
  jwks_uri: string
  /**
   * The URI to the token endpoint.
   */
  token_endpoint: string
  /**
   * The URI to the authorization endpoint.
   */
  authorization_endpoint: string
}

/**
 * The tokens returned by the authorization server.
 */
export interface Tokens {
  /**
   * The access token.
   */
  access: string
  /**
   * The refresh token.
   */
  refresh: string
}

interface ResponseLike {
  json(): Promise<unknown>
  ok: Response["ok"]
}
type FetchLike = (...args: any[]) => Promise<ResponseLike>

export type Challenge = {
  state: string
  verifier?: string
}

/**
 * The input object for the client.
 */
export interface ClientInput {
  /**
   * The client ID.
   */
  clientID: string
  /**
   * The issuer URL.
   */
  issuer?: string
  /**
   * The fetch function to use.
   */
  fetch?: FetchLike
}

export interface AuthorizeOptions {
  pkce?: boolean
  provider?: string
}

export interface AuthorizeResult {
  challenge: Challenge
  url: string
}

export interface ExchangeSuccess {
  err: false
  tokens: Tokens
}

export interface ExchangeError {
  err: InvalidAuthorizationCodeError
}

export interface RefreshOptions {
  access?: string
}

export interface RefreshSuccess {
  err: false
  tokens?: Tokens
}

export interface RefreshError {
  err: InvalidRefreshTokenError | InvalidAccessTokenError
}

export interface VerifyOptions {
  refresh?: string
  issuer?: string
  audience?: string
  fetch?: typeof fetch
}

export interface VerifyResult<T extends SubjectSchema> {
  err?: undefined
  tokens?: Tokens
  aud: string
  subject: {
    [type in keyof T]: { type: type; properties: v1.InferOutput<T[type]> }
  }[keyof T]
}

export interface VerifyError {
  err: InvalidRefreshTokenError | InvalidAccessTokenError
}

export interface Client {
  /**
   * Authorize the client.
   * @param redirectURI - The redirect URI.
   * @param response - The response type.
   * @param opts - Authorization options.
   */
  authorize(
    redirectURI: string,
    response: "code" | "token",
    opts?: AuthorizeOptions,
  ): Promise<AuthorizeResult>
  /**
   * Exchange the authorization code for tokens.
   * @param code - The authorization code.
   * @param redirectURI - The redirect URI.
   * @param verifier - The verifier.
   */
  exchange(
    code: string,
    redirectURI: string,
    verifier?: string,
  ): Promise<ExchangeSuccess | ExchangeError>
  /**
   * Refresh the tokens.
   * @param refresh - The refresh token.
   * @param opts - Refresh options.
   */
  refresh(
    refresh: string,
    opts?: RefreshOptions,
  ): Promise<RefreshSuccess | RefreshError>
  /**
   * Verify the token.
   * @param subjects - The subjects.
   * @param token - The token.
   * @param options - Verification options.
   */
  verify<T extends SubjectSchema>(
    subjects: T,
    token: string,
    options?: VerifyOptions,
  ): Promise<VerifyResult<T> | VerifyError>
}

/**
 * Create a client object for interacting with an OAuth 2.0 authorization server.
 * @param input - The input object containing the client ID, issuer, and optional fetch function.
 * @returns An object containing methods for authorizing, exchanging tokens, refreshing tokens, and verifying tokens.
 */
export function createClient(input: ClientInput): Client {
  const jwksCache = new Map<string, ReturnType<typeof createLocalJWKSet>>()
  const issuerCache = new Map<string, WellKnown>()
  const issuer = input.issuer || process.env.OPENAUTH_ISSUER
  if (!issuer) throw new Error("No issuer")
  const f = input.fetch ?? fetch

  async function getIssuer() {
    const cached = issuerCache.get(issuer!)
    if (cached) return cached
    const wellKnown = (await (f || fetch)(
      `${issuer}/.well-known/oauth-authorization-server`,
    ).then((r) => r.json())) as WellKnown
    issuerCache.set(issuer!, wellKnown)
    return wellKnown
  }

  async function getJWKS() {
    const wk = await getIssuer()
    const cached = jwksCache.get(issuer!)
    if (cached) return cached
    const keyset = (await (f || fetch)(wk.jwks_uri).then((r) =>
      r.json(),
    )) as JSONWebKeySet
    const result = createLocalJWKSet(keyset)
    jwksCache.set(issuer!, result)
    return result
  }

  const result = {
    async authorize(
      redirectURI: string,
      response: "code" | "token",
      opts?: AuthorizeOptions,
    ) {
      const result = new URL(issuer + "/authorize")
      const challenge: Challenge = {
        state: crypto.randomUUID(),
      }
      result.searchParams.set("client_id", input.clientID)
      result.searchParams.set("redirect_uri", redirectURI)
      result.searchParams.set("response_type", response)
      result.searchParams.set("state", challenge.state)
      if (opts?.provider) result.searchParams.set("provider", opts.provider)
      if (opts?.pkce && response === "code") {
        const pkce = await generatePKCE()
        result.searchParams.set("code_challenge_method", "S256")
        result.searchParams.set("code_challenge", pkce.challenge)
        challenge.verifier = pkce.verifier
      }
      return {
        challenge,
        url: result.toString(),
      }
    },
    /**
     * @deprecated use `authorize` instead, it will do pkce by default unless disabled with `opts.pkce = false`
     */
    async pkce(
      redirectURI: string,
      opts?: {
        provider?: string
      },
    ) {
      const result = new URL(issuer + "/authorize")
      if (opts?.provider) result.searchParams.set("provider", opts.provider)
      result.searchParams.set("client_id", input.clientID)
      result.searchParams.set("redirect_uri", redirectURI)
      result.searchParams.set("response_type", "code")
      const pkce = await generatePKCE()
      result.searchParams.set("code_challenge_method", "S256")
      result.searchParams.set("code_challenge", pkce.challenge)
      return [pkce.verifier, result.toString()]
    },
    async exchange(
      code: string,
      redirectURI: string,
      verifier?: string,
    ): Promise<ExchangeSuccess | ExchangeError> {
      const tokens = await f(issuer + "/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          redirect_uri: redirectURI,
          grant_type: "authorization_code",
          client_id: input.clientID,
          code_verifier: verifier || "",
        }).toString(),
      })
      const json = (await tokens.json()) as any
      if (!tokens.ok) {
        return {
          err: new InvalidAuthorizationCodeError(),
        }
      }
      return {
        err: false,
        tokens: {
          access: json.access_token as string,
          refresh: json.refresh_token as string,
        },
      }
    },
    async refresh(
      refresh: string,
      opts?: RefreshOptions,
    ): Promise<RefreshSuccess | RefreshError> {
      if (opts && opts.access) {
        const decoded = decodeJwt(opts.access)
        if (!decoded) {
          return {
            err: new InvalidAccessTokenError(),
          }
        }
        // allow 30s window for expiration
        if ((decoded.exp || 0) > Date.now() / 1000 + 30) {
          return {
            err: false,
          }
        }
      }
      const tokens = await f(issuer + "/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
        }).toString(),
      })
      const json = (await tokens.json()) as any
      if (!tokens.ok) {
        return {
          err: new InvalidRefreshTokenError(),
        }
      }
      return {
        err: false,
        tokens: {
          access: json.access_token as string,
          refresh: json.refresh_token as string,
        },
      }
    },
    async revoke(
      refresh: string,
      opts?: {
        all?: boolean
      },
    ): Promise<{ err: false } | { err: InvalidRefreshTokenError }> {
      const tokens = await f(issuer + "/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: refresh,
          revoke_all: opts?.all ? "true" : "false",
        }).toString(),
      })
      if (!tokens.ok) {
        return {
          err: new InvalidRefreshTokenError(),
        }
      }
      return { err: false }
    },
    async verify<T extends SubjectSchema>(
      subjects: T,
      token: string,
      options?: VerifyOptions,
    ): Promise<VerifyResult<T> | VerifyError> {
      const jwks = await getJWKS()
      try {
        const result = await jwtVerify<{
          mode: "access"
          type: keyof T
          properties: v1.InferInput<T[keyof T]>
        }>(token, jwks, {
          issuer,
        })
        const validated = await subjects[result.payload.type][
          "~standard"
        ].validate(result.payload.properties)
        if (!validated.issues && result.payload.mode === "access")
          return {
            aud: result.payload.aud as string,
            subject: {
              type: result.payload.type,
              properties: validated.value,
            } as any,
          }
        return {
          err: new InvalidSubjectError(),
        }
      } catch (e) {
        if (e instanceof errors.JWTExpired && options?.refresh) {
          const refreshed = await this.refresh(options.refresh)
          if (refreshed.err) return refreshed
          const verified = await result.verify(
            subjects,
            refreshed.tokens!.access,
            {
              refresh: refreshed.tokens!.refresh,
              issuer,
              fetch: options?.fetch,
            },
          )
          if (verified.err) return verified
          verified.tokens = refreshed.tokens
          return verified
        }
        return {
          err: new InvalidAccessTokenError(),
        }
      }
    },
  }
  return result
}
