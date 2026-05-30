import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

const s3Client = new S3Client({});

interface PresignRequest {
  fileName: string;
  contentType: string;
  category?: 'profile' | 'gallery' | 'vaccination';
}

function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) {
    return jsonResponse(400, { message: 'Request body is required' });
  }

  const bucket = process.env.USER_CONTENT_BUCKET;
  if (!bucket) {
    return jsonResponse(500, { message: 'USER_CONTENT_BUCKET is not configured' });
  }

  let payload: PresignRequest;
  try {
    payload = JSON.parse(event.body) as PresignRequest;
  } catch {
    return jsonResponse(400, { message: 'Invalid JSON body' });
  }

  if (!payload.fileName || !payload.contentType) {
    return jsonResponse(400, {
      message: 'fileName and contentType are required',
    });
  }

  const userId =
    (event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined) ??
    'anonymous';
  const category = payload.category ?? 'gallery';
  const objectKey = `users/${userId}/${category}/${Date.now()}-${sanitizeFileName(payload.fileName)}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: payload.contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
  const cdnDomain = process.env.CDN_DOMAIN;

  return jsonResponse(200, {
    uploadUrl,
    objectKey,
    expiresInSeconds: 900,
    publicUrl: cdnDomain ? `https://${cdnDomain}/${objectKey}` : undefined,
  });
}
