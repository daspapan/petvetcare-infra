import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createDbClient } from '../shared/db';
import {
  getDbConfig,
  handleError,
  jsonResponse,
  parseBody,
  requireAuth,
} from '../shared/api';

const s3 = new S3Client({});

interface PresignRequest {
  fileName: string;
  contentType: string;
  category?: string;
}

interface CompleteUploadRequest {
  objectKey: string;
  fileName: string;
  contentType?: string;
  fileSize?: number;
  category: string;
}

/** GeneratePresignedUrlLambda */
async function presignedUrl(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = requireAuth(event);
  const bucket = process.env.PUBLIC_ASSET_BUCKET!;
  const payload = parseBody<PresignRequest>(event);

  if (!payload.fileName || !payload.contentType) {
    return jsonResponse(400, { error: 'fileName and contentType are required' });
  }

  const category = payload.category ?? 'general';
  const safeName = payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `uploads/${sub}/${category}/${Date.now()}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: payload.contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  const cdnDomain = process.env.PUBLIC_ASSET_URL?.replace('https://', '');

  return jsonResponse(200, {
    uploadUrl,
    objectKey,
    expiresInSeconds: 900,
    publicUrl: cdnDomain ? `https://${cdnDomain}/${objectKey}` : undefined,
  });
}

/** CompleteUploadLambda */
async function completeUpload(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = requireAuth(event);
  const payload = parseBody<CompleteUploadRequest>(event);
  const dbConfig = getDbConfig();
  const client = await createDbClient(dbConfig);

  try {
    await client.connect();
    const userResult = await client.query(
      'SELECT id FROM users WHERE cognito_sub = $1',
      [sub],
    );
    const userId = userResult.rows[0]?.id;
    if (!userId) {
      return jsonResponse(404, { error: 'User not found' });
    }

    const publicUrl = process.env.PUBLIC_ASSET_URL
      ? `${process.env.PUBLIC_ASSET_URL}/${payload.objectKey}`
      : undefined;

    const result = await client.query(
      `INSERT INTO file_uploads (user_id, object_key, file_name, content_type, file_size, category, status, public_url)
       VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', $7) RETURNING *`,
      [userId, payload.objectKey, payload.fileName, payload.contentType, payload.fileSize, payload.category, publicUrl],
    );

    return jsonResponse(201, { file: result.rows[0] });
  } finally {
    await client.end();
  }
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const { httpMethod, path } = event;

    if (httpMethod === 'POST' && path.endsWith('/files/presigned-url')) {
      return presignedUrl(event);
    }
    if (httpMethod === 'POST' && path.endsWith('/files/complete-upload')) {
      return completeUpload(event);
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    return handleError(error);
  }
}
