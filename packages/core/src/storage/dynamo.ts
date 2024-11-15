import { joinKey, StorageAdapter } from "./storage.js";
import { AwsClient } from "aws4fetch";
import type {
  AttributeValue,
  GetItemOutput,
  ScanCommandOutput,
} from "@aws-sdk/client-dynamodb";

interface DynamoStorageOptions {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  table: string;
  /**
   * The region of the DynamoDB table.
   *
   * @default "us-east-1"
   */
  region?: string;
  /**
   * The Partition Key of the table.
   *
   * @default "pk"
   */
  pk?: string;
  /**
   * The Sort Key of the table.
   *
   * @default "sk"
   */
  sk?: string;
  /**
   * The Time To Live attribute name of the table.
   *
   * @default "expiresAt"
   */
  ttl?: string;
}

export function DynamoStorage(options: DynamoStorageOptions): StorageAdapter {
  const client = new AwsClient({
    ...options,
    service: "dynamodb",
  });

  function parseKey(key: string[]) {
    if (key.length === 2) {
      return {
        pk: key[0],
        sk: key[1],
      };
    }

    return {
      pk: joinKey(key.slice(0, 2)),
      sk: joinKey(key.slice(2)),
    };
  }

  const baseUrl = new URL(
    `https://dynamodb.${options.region ?? "us-east-1"}.amazonaws.com`
  );

  return {
    async get(key: string[]) {
      const { pk, sk } = parseKey(key);
      const response = await client.fetch(baseUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.0",
          "X-Amz-Target": "DynamoDB_20120810.GetItem",
        },
        body: JSON.stringify({
          TableName: options.table,
          Key: {
            [options.pk ?? "pk"]: {
              S: pk,
            },
            [options.sk ?? "sk"]: {
              S: sk,
            },
          },
        }),
      });
      const data = (await response.json()) as GetItemOutput;

      try {
        if (data?.Item?.value?.S) {
          return JSON.parse(data.Item.value.S);
        }
      } catch (e) {
        console.error("Failed to parse item", data, e);
      }
    },

    async set(key: string[], value: any, ttl?: number) {
      const { pk, sk } = parseKey(key);
      const item = {
        [options.pk ?? "pk"]: { S: pk },
        [options.sk ?? "sk"]: { S: sk },
        value: { S: JSON.stringify(value) },
      };

      if (typeof ttl === "number" && ttl > 0) {
        item[options.ttl ?? "expiresAt"] = {
          // @ts-expect-error
          N: ttl.toString(),
        };
      }

      await client.fetch(baseUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.0",
          "X-Amz-Target": "DynamoDB_20120810.PutItem",
        },
        body: JSON.stringify({
          TableName: options.table,
          Item: item,
        }),
      });
    },

    async remove(key: string[]) {
      const { pk, sk } = parseKey(key);
      await client.fetch(baseUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.0",
          "X-Amz-Target": "DynamoDB_20120810.DeleteItem",
        },
        body: JSON.stringify({
          TableName: options.table,
          Key: {
            [options.pk ?? "pk"]: {
              S: pk,
            },
            [options.sk ?? "sk"]: {
              S: sk,
            },
          },
        }),
      });
    },

    async *scan(prefix: string[]) {
      let lastEvaluatedKey: Record<string, AttributeValue> | undefined;
      const { pk } = parseKey(prefix);

      do {
        const response = (await client
          .fetch(baseUrl.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/x-amz-json-1.0",
              "X-Amz-Target": "DynamoDB_20120810.Query",
            },
            body: JSON.stringify({
              TableName: options.table,
              ExclusiveStartKey: lastEvaluatedKey,
              KeyConditionExpression: "#pk = :pk",
              ExpressionAttributeNames: {
                "#pk": options.pk ?? "pk",
              },
              ExpressionAttributeValues: {
                ":pk": { S: pk },
              },
            }),
          })
          .then((res) => res.json())) as unknown as ScanCommandOutput;

        const items = response?.Items;

        if (!items || items.length === 0) {
          break;
        }

        for (const item of items) {
          if (!item) {
            continue;
          }
          const _pk = item[options.pk ?? "pk"].S ?? "";
          const _sk = item[options.sk ?? "sk"].S ?? "";
          if (!_pk) {
            continue;
          }
          try {
            yield [joinKey([_pk, _sk]), JSON.parse(item.value.S ?? "{}")];
          } catch (e) {
            console.error("Failed to parse item", item, e);
            continue;
          }
        }

        lastEvaluatedKey = response?.LastEvaluatedKey;
      } while (lastEvaluatedKey);
    },
  };
}
