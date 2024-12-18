import { OauthError } from "../error.js"
import { getRelativeUrl } from "../util.js"
import { Adapter } from "./adapter.js"

export interface Oauth2Config {
  type?: string
  clientID: string
  clientSecret: string
  endpoint: {
    authorization: string
    token: string
  }
  scopes: string[]
  query?: Record<string, string>
  responseMode?: "query" | "form_post"
}

export type Oauth2WrappedConfig = Omit<Oauth2Config, "endpoint" | "name">

export interface Oauth2Token {
  access: string
  refresh: string
  expiry: number
  raw: Record<string, any>
}

interface AdapterState {
  state: string
  redirect: string
}

export function Oauth2Adapter(config: Oauth2Config) {
  const query = config.query || {}
  return {
    type: config.type || "oauth2",
    init(routes, ctx) {
      routes.get("/authorize", async (c) => {
        const state = crypto.randomUUID()
        await ctx.set<AdapterState>(c, "adapter", 60 * 10, {
          state,
          redirect: getRelativeUrl(c, "./callback"),
        })
        const authorization = new URL(config.endpoint.authorization)
        authorization.searchParams.set("client_id", config.clientID)
        authorization.searchParams.set(
          "redirect_uri",
          getRelativeUrl(c, "./callback"),
        )
        authorization.searchParams.set("response_type", "code")
        authorization.searchParams.set("state", state)
        authorization.searchParams.set("scope", config.scopes.join(" "))
        if (config.responseMode) {
          authorization.searchParams.set("response_mode", config.responseMode)
        }
        for (const [key, value] of Object.entries(query)) {
          authorization.searchParams.set(key, value)
        }
        return c.redirect(authorization.toString())
      })

      async function handleCallback(c) {
        const adapter = (await ctx.get(c, "adapter")) as AdapterState
        let code: string | null = null
        let state: string | null = null
        let error: string | null = null
        let errorDescription: string | null = null
        let userInfo: Record<string, any> = {}

        if (c.req.method === "POST") {
          const formData = await c.req.formData()
          code = formData.get("code")?.toString() || null
          state = formData.get("state")?.toString() || null
          error = formData.get("error")?.toString() || null
          errorDescription = formData.get("error_description")?.toString() || ""
          const user = formData.get("user")?.toString()
          if (user) {
            try {
              userInfo = JSON.parse(user)
            } catch (e) {
              console.warn("Failed to parse user info:", e)
            }
          }
        } else {
          code = c.req.query("code")
          state = c.req.query("state")
          error = c.req.query("error")
          errorDescription = c.req.query("error_description")?.toString() || ""
        }

        if (error)
          throw new OauthError(error.toString() as any, errorDescription)
        if (!adapter || !code || (adapter.state && state !== adapter.state))
          return c.redirect(getRelativeUrl(c, "./authorize"))

        const body = new URLSearchParams({
          client_id: config.clientID,
          client_secret: config.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: adapter.redirect,
        })

        const json: any = await fetch(config.endpoint.token, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
        }).then((r) => r.json())

        if ("error" in json)
          throw new OauthError(json.error, json.error_description)

        return ctx.success(c, {
          clientID: config.clientID,
          tokenset: {
            get access() {
              return json.access_token
            },
            get refresh() {
              return json.refresh_token
            },
            get expiry() {
              return json.expires_in
            },
            get raw() {
              return { ...json, userInfo }
            },
          },
        })
      }

      routes.get("/callback", handleCallback)
      routes.post("/callback", handleCallback)
    },
  } satisfies Adapter<{ tokenset: Oauth2Token; clientID: string }>
}
