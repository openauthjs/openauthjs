import type { Service, KVNamespace } from "@cloudflare/workers-types"
import { createClient } from "@openauthjs/openauth/client"
import { subjects } from "../../subjects"

interface Env {
  OPENAUTH_ISSUER: string
  Auth: Service
  AuthKV: KVNamespace
  CloudflareAuth: Service
}

export default {
  async fetch(request: Request, env: Env) {
    const client = createClient({
      clientID: "cloudflare-api",
      // enables worker to worker communication if authorizer is also a worker
      fetch: (input, init) => env.CloudflareAuth.fetch(input, init),
      issuer: env.OPENAUTH_ISSUER,
    })
    const url = new URL(request.url)
    const redirectURI = url.origin + "/callback"

    switch (url.pathname) {
      case "/callback":
        try {
          const code = url.searchParams.get("code")!
          const state = url.searchParams.get("state")!
          const challenge = await env.AuthKV.get(`oauth:challenge ${state}`)
          if (!challenge) throw new Error("Invalid state")
          await env.AuthKV.delete(`oauth:challenge ${state}`)
          const exchanged = await client.exchange(code, redirectURI)
          if (exchanged.err) throw new Error("Invalid code")
          const response = new Response(null, { status: 302, headers: {} })
          response.headers.set("Location", url.origin)
          setSession(
            response,
            exchanged.tokens.access,
            exchanged.tokens.refresh,
          )
          return response
        } catch (e: any) {
          return new Response(e.toString())
        }
      case "/authorize":
        const { state } = await client.authorize(redirectURI, "code")
        await env.AuthKV.put(`oauth:challenge ${state}`, "1", {
          expirationTtl: 60, // in seconds
        })
        return Response.redirect(url, 302)
      case "/":
        const cookies = new URLSearchParams(
          request.headers.get("cookie")?.replaceAll("; ", "&"),
        )
        const verified = await client.verify(
          subjects,
          cookies.get("access_token")!,
          {
            refresh: cookies.get("refresh_token") || undefined,
          },
        )
        if (verified.err)
          return Response.redirect(url.origin + "/authorize", 302)
        const resp = Response.json(verified.subject)
        if (verified.tokens)
          setSession(resp, verified.tokens.access, verified.tokens.refresh)
        return resp
      default:
        return new Response("Not found", { status: 404 })
    }
  },
}

function setSession(response: Response, access: string, refresh: string) {
  if (access) {
    response.headers.append(
      "Set-Cookie",
      `access_token=${access}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2147483647`,
    )
  }
  if (refresh) {
    response.headers.append(
      "Set-Cookie",
      `refresh_token=${refresh}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2147483647`,
    )
  }
}
