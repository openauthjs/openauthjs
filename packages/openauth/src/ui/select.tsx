/** @jsxImportSource hono/jsx */

import { Layout } from "./base.js"

const DEFAULT_COPY = {
  continue_with: "Continue with",
  providers: {
    twitch: "Twitch",
    google: "Google",
    github: "GitHub",
  },
} satisfies Record<string, any>

export type SelectUICopy = typeof DEFAULT_COPY

export interface SelectProps {
  providers?: Record<
    string,
    {
      hide?: boolean
      display?: string
    }
  >
  copy?: Partial<SelectUICopy>
}

export function Select(props?: SelectProps) {
  return async (
    providers: Record<string, string>,
    _req: Request,
  ): Promise<Response> => {
    const copy = {
      ...DEFAULT_COPY,
      ...props?.copy,
    }
    const jsx = (
      <Layout>
        <div data-component="form">
          {Object.entries(providers).map(([key, type]) => {
            const match = props?.providers?.[key]
            if (match?.hide) return
            const icon = ICON[key]
            return (
              <a
                href={`/${key}/authorize`}
                data-component="button"
                data-color="ghost"
              >
                {icon && <i data-slot="icon">{icon}</i>}
                {copy.continue_with}{" "}
                {match?.display || copy.providers[type] || type}
              </a>
            )
          })}
        </div>
      </Layout>
    )

    return new Response(jsx.toString(), {
      headers: {
        "Content-Type": "text/html",
      },
    })
  }
}

const ICON: Record<string, any> = {
  code: (
    <svg
      fill="currentColor"
      viewBox="0 0 52 52"
      data-name="Layer 1"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.55,36.91A6.55,6.55,0,1,1,2,43.45,6.54,6.54,0,0,1,8.55,36.91Zm17.45,0a6.55,6.55,0,1,1-6.55,6.54A6.55,6.55,0,0,1,26,36.91Zm17.45,0a6.55,6.55,0,1,1-6.54,6.54A6.54,6.54,0,0,1,43.45,36.91ZM8.55,19.45A6.55,6.55,0,1,1,2,26,6.55,6.55,0,0,1,8.55,19.45Zm17.45,0A6.55,6.55,0,1,1,19.45,26,6.56,6.56,0,0,1,26,19.45Zm17.45,0A6.55,6.55,0,1,1,36.91,26,6.55,6.55,0,0,1,43.45,19.45ZM8.55,2A6.55,6.55,0,1,1,2,8.55,6.54,6.54,0,0,1,8.55,2ZM26,2a6.55,6.55,0,1,1-6.55,6.55A6.55,6.55,0,0,1,26,2ZM43.45,2a6.55,6.55,0,1,1-6.54,6.55A6.55,6.55,0,0,1,43.45,2Z"
        fill-rule="evenodd"
      />
    </svg>
  ),
  password: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path
        fill-rule="evenodd"
        d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z"
        clip-rule="evenodd"
      />
    </svg>
  ),
  twitch: (
    <svg role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
      <path
        fill="currentColor"
        d="M40.1 32L10 108.9v314.3h107V480h60.2l56.8-56.8h87l117-117V32H40.1zm357.8 254.1L331 353H224l-56.8 56.8V353H76.9V72.1h321v214zM331 149v116.9h-40.1V149H331zm-107 0v116.9h-40.1V149H224z"
      ></path>
    </svg>
  ),
  google: (
    <svg role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
      <path
        fill="currentColor"
        d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
      ></path>
    </svg>
  ),
  github: (
    <svg role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512">
      <path
        fill="currentColor"
        d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"
      ></path>
    </svg>
  ),
}
