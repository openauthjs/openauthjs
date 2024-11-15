import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createClient } from "../../core/src/client.js";
import { subjects } from "../subjects.js";

function createResponse(
  status: number,
  body?: any,
  headers: Record<string, string> = {},
  cookies: string[] = []
): APIGatewayProxyResultV2 {
  console.log("cookies", cookies, cookies.join("; "));
  return {
    statusCode: status,
    body: body ? JSON.stringify(body) : "",
    cookies: cookies,
    headers: headers,
    isBase64Encoded: false,
  };
}

function setSession(
  cookies: string[],
  accessToken?: string,
  refreshToken?: string
) {
  if (accessToken) {
    cookies.push(
      `access_token=${accessToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2147483647`
    );
  }
  if (refreshToken) {
    cookies.push(
      `refresh_token=${refreshToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2147483647`
    );
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const client = createClient({
    clientID: "123",
    fetch: fetch,
  });

  const url = new URL(
    event.rawPath,
    `https://${event.requestContext.domainName}`
  );
  const redirectURI = url.origin + "/callback";
  const cookies = new URLSearchParams(
    event.headers.cookie?.replaceAll("; ", "&") || ""
  );

  switch (event.rawPath) {
    case "/callback":
      try {
        const code = event.queryStringParameters?.code!;
        const tokens = await client.exchange(code, redirectURI);
        const setCookies: string[] = [];
        setSession(setCookies, tokens.access, tokens.refresh);
        return createResponse(302, null, { Location: url.origin }, setCookies);
      } catch (e: any) {
        return createResponse(500, e.toString());
      }

    case "/authorize":
      return createResponse(302, null, {
        Location: client.authorize("code", redirectURI, "code"),
      });

    case "/":
      try {
        const verified = await client.verify(
          subjects,
          cookies.get("access_token")!,
          {
            refresh: cookies.get("refresh_token") || undefined,
          }
        );
        const setCookies: string[] = [];
        setSession(setCookies, verified.access, verified.refresh);
        return createResponse(200, verified.subject, {}, setCookies);
      } catch (e) {
        return createResponse(302, null, {
          Location: url.origin + "/authorize",
        });
      }

    default:
      return createResponse(404, "Not found");
  }
};
