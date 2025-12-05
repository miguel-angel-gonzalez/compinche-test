# Compinche File Manager

Secure serverless file manager built on AWS (API Gateway, Lambda, S3, DynamoDB, Cognito) with a React + Vite frontend.

---

## 1. Backend: how to run

> The backend is mostly deployed in AWS. Locally you mainly run tests and debug Lambdas.

### Prerequisites

- Node.js 20+
- npm or yarn
- AWS account with:
  - S3 bucket (e.g. `660348065850-file-bucket`)
  - DynamoDB tables: `UserFiles`, `FileAudit`
  - Cognito User Pool + client
  - API Gateway already configured
- AWS credentials in your shell (`aws configure` or env vars).

### Install & test

From the project root:

```bash
npm install
npm test
```

This installs dependencies and runs Jest tests for all Node.js Lambdas.

---

## 2. Frontend: how to run

The frontend lives in `frontend/` and uses React + Vite + TypeScript.

```bash
cd frontend
npm install

# Development
npm run dev   # http://localhost:3000

# Production build
npm run build
npm run preview
```

During development Vite proxies `/api` to your API Gateway:

- `vite.config.ts` → `/api -> https://kp9zi5y7lb.execute-api.us-east-1.amazonaws.com/dev/api`
- The proxy forwards the `Authorization` header so API Gateway receives the Cognito JWT.

### Required environment variables (frontend)

Frontend env vars are read from Vite (`import.meta.env`). See `frontend/.env.example`.

```bash
VITE_COGNITO_USER_POOL_ID=us-east-1_gGIEj2gYu
VITE_COGNITO_USER_POOL_CLIENT_ID=1i1e77616ajqqf5ed63vuc6etf
VITE_COGNITO_REGION=us-east-1
VITE_API_BASE_URL=/api
```

> Copy `.env.example` to `.env` in the `frontend/` folder and adjust values if needed.

### Test user credentials (dev)

For local testing against the existing Cognito pool you can use:

- Email: `test-compinche@gmail.com`
- Password: `Gs0jPmlx8YFNH9@`

---

## 3. Presigned URL flow (summary)

The system uses **S3 presigned URLs** so the browser uploads/downloads file bytes directly to S3. Lambdas only validate and manage metadata.

### Upload

1. Frontend calls `POST /files/presigned/upload` with file name, type, and size.
2. `upload_file` Lambda:
   - Validates JWT, size (≤ 10 MB) and MIME type.
   - Creates a `fileId` and S3 key `users/{userId}/uploads/{fileId}-{sanitizedName}`.
   - Stores metadata in `UserFiles` with status `pending`.
   - Returns a presigned **PUT** URL for S3.
3. Frontend uploads the file using that URL.

### Download

1. Frontend calls `POST /files/presigned/download` with `{ fileId }`.
2. `download_file` Lambda:
   - Checks ownership and status in `UserFiles`.
   - Returns presigned **GET** URL with `Content-Disposition`.
   - Writes a `download` entry in `FileAudit`.

### Delete (soft delete)

1. Frontend calls `POST /files/delete` with `{ fileId }`.
2. `delete_file` Lambda:
   - Tries to delete from S3.
   - Marks the record in `UserFiles` as `deleted`.
   - Writes a `delete` entry in `FileAudit`.

---

## 4. DynamoDB model (short)

### `UserFiles`

- PK: `userId` (string)
- SK: `fileId` (string, UUID)
- Attributes: `fileName`, `contentType`, `fileSize`, `s3Key`, `status`, `createdAt`, `updatedAt?`, `deletedAt?`.
- Used by:
  - `get_files` (list visible files per user).
  - `download_file`, `delete_file` (single file operations).

### `FileAudit`

- PK: `userId` (string)
- SK: `timestamp` (ISO string)
- Attributes: `fileId`, `action`, `metadata` (flexible map).
- Used by:
  - All file Lambdas to write audit entries.
  - `audit_file` to list audit logs per user (with optional filters).

---

## 5. Architecture (high level)

```text
React + Vite (browser)
   |
   |  HTTPS (Authorization: Bearer <Cognito JWT>)
   v
API Gateway (CORS + Cognito authorizer)
   |
   +--> Lambda: upload_file
   |
   +--> Lambda: download_file
   |
   +--> Lambda: delete_file
   |
   +--> Lambda: get_files
   |
   +--> Lambda: audit_file

S3 bucket: 660348065850-file-bucket
   - users/{userId}/uploads/...

DynamoDB tables:
   - UserFiles (file metadata)
   - FileAudit (audit trail)
```

---

## 6. Limitations

- Single AWS account/region expected (`us-east-1`).
- No global admin view of all users' audits (queries are per `userId`).
- No background process to confirm S3 uploads and flip `status` from `pending` to `uploaded`.
- Error messages are mostly generic (`Internal server error`) toward clients.

---

## 7. Possible improvements

- Add S3 event Lambda to confirm uploads and clean up old `pending` records.
- Add rich filters and pagination in the audit log UI.
- Harden security (KMS encryption, WAF, rate limiting).
- Describe full infrastructure as code (Serverless/Terraform) and wire CI/CD.
- Add structured logging, correlation IDs, and CloudWatch dashboards.

