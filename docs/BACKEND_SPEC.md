# PetVetCare Backend Implementation Specification

**Version:** 1.0  
**Domain:** petvetcare.app  
**Stack:** Next.js 15 · TypeScript · AWS CDK · Lambda · API Gateway REST · Aurora PostgreSQL Serverless v2 · Cognito · SES · EventBridge · SNS · S3 · CloudFront · Amplify · CloudWatch · Secrets Manager

---

## 1. API Gateway Endpoint Catalog

Base URL: `https://{api-id}.execute-api.{region}.amazonaws.com/{env}` or `https://api.dev.petvetcare.app`

| Method | Path | Lambda | Auth | Roles |
|--------|------|--------|------|-------|
| GET | `/health` | HealthFunction | Public | — |
| POST | `/auth/send-otp` | AuthFunction (SendOtpLambda) | Public | — |
| POST | `/auth/verify-otp` | AuthFunction (VerifyOtpLambda) | Public | — |
| POST | `/auth/logout` | AuthFunction (LogoutLambda) | JWT | Any |
| GET | `/auth/me` | AuthFunction (GetCurrentUserLambda) | JWT | Any |
| GET | `/profile` | ProfileFunction | JWT | Any |
| PUT | `/profile` | ProfileFunction | JWT | Any |
| POST | `/profile/avatar` | ProfileFunction | JWT | Any |
| DELETE | `/profile/avatar` | ProfileFunction | JWT | Any |
| POST | `/pets` | PetsFunction (CreatePetLambda) | JWT | PET_OWNER+ |
| GET | `/pets` | PetsFunction (GetPetsLambda) | JWT | PET_OWNER+ |
| GET | `/pets/{petId}` | PetsFunction (GetPetLambda) | JWT | Owner |
| PUT | `/pets/{petId}` | PetsFunction (UpdatePetLambda) | JWT | Owner |
| DELETE | `/pets/{petId}` | PetsFunction (DeletePetLambda) | JWT | Owner |
| POST | `/pets/{petId}/health-records` | HealthRecordsFunction | JWT | Owner |
| GET | `/pets/{petId}/health-records` | HealthRecordsFunction | JWT | Owner |
| PUT | `/pets/{petId}/health-records/{recordId}` | HealthRecordsFunction | JWT | Owner |
| DELETE | `/pets/{petId}/health-records/{recordId}` | HealthRecordsFunction | JWT | Owner |
| POST | `/pets/{petId}/vaccinations` | VaccinationsFunction | JWT | Owner |
| GET | `/pets/{petId}/vaccinations` | VaccinationsFunction | JWT | Owner |
| PUT | `/vaccinations/{vaccinationId}` | VaccinationsFunction | JWT | Owner |
| DELETE | `/vaccinations/{vaccinationId}` | VaccinationsFunction | JWT | Owner |
| POST | `/pets/{petId}/prescriptions` | PrescriptionsFunction | JWT | Doctor/Owner |
| GET | `/pets/{petId}/prescriptions` | PrescriptionsFunction | JWT | Owner |
| GET | `/prescriptions/{id}` | PrescriptionsFunction | JWT | Owner |
| DELETE | `/prescriptions/{id}` | PrescriptionsFunction | JWT | Owner |
| POST | `/appointments` | AppointmentsFunction | JWT | PET_OWNER |
| GET | `/appointments` | AppointmentsFunction | JWT | Any |
| GET | `/appointments/{appointmentId}` | AppointmentsFunction | JWT | Participant |
| PUT | `/appointments/{appointmentId}` | AppointmentsFunction | JWT | Participant |
| DELETE | `/appointments/{appointmentId}` | AppointmentsFunction | JWT | Owner |
| POST | `/doctors` | DoctorsFunction | JWT | ADMIN, SUPERVISOR |
| PUT | `/doctors/{doctorId}` | DoctorsFunction | JWT | ADMIN, SUPERVISOR |
| GET | `/doctors` | DoctorsFunction | JWT | Any |
| GET | `/doctors/{doctorId}` | DoctorsFunction | JWT | Any |
| DELETE | `/doctors/{doctorId}` | DoctorsFunction | JWT | ADMIN |
| POST | `/stores/register` | StoresFunction | JWT | MEDICINE_STORE |
| GET | `/stores` | StoresFunction | JWT | Any |
| GET | `/stores/{storeId}` | StoresFunction | JWT | Any |
| PUT | `/stores/{storeId}` | StoresFunction | JWT | Store owner |
| DELETE | `/stores/{storeId}` | StoresFunction | JWT | ADMIN |
| POST | `/stores/{storeId}/approve` | StoresFunction | JWT | ADMIN, SUPERVISOR |
| POST | `/stores/{storeId}/reject` | StoresFunction | JWT | ADMIN, SUPERVISOR |
| POST | `/products` | ProductsFunction | JWT | MEDICINE_STORE, ADMIN |
| GET | `/products` | ProductsFunction | JWT | Any |
| GET | `/products/{productId}` | ProductsFunction | JWT | Any |
| PUT | `/products/{productId}` | ProductsFunction | JWT | Store owner |
| DELETE | `/products/{productId}` | ProductsFunction | JWT | Store owner |
| POST | `/orders` | OrdersFunction | JWT | PET_OWNER |
| GET | `/orders` | OrdersFunction | JWT | Owner |
| GET | `/orders/{orderId}` | OrdersFunction | JWT | Owner |
| PUT | `/orders/{orderId}` | OrdersFunction | JWT | Owner/Admin |
| POST | `/payments/initiate` | PaymentsFunction | JWT | Any |
| POST | `/payments/success` | PaymentsFunction | JWT | Any |
| POST | `/payments/failure` | PaymentsFunction | JWT | Any |
| GET | `/payments/{paymentId}` | PaymentsFunction | JWT | Owner |
| POST | `/tickets` | TicketsFunction | JWT | Any |
| GET | `/tickets` | TicketsFunction | JWT | Any |
| GET | `/tickets/{ticketId}` | TicketsFunction | JWT | Participant |
| PUT | `/tickets/{ticketId}` | TicketsFunction | JWT | Participant |
| POST | `/tickets/{ticketId}/comment` | TicketsFunction | JWT | Participant |
| POST | `/tickets/{ticketId}/assign` | TicketsFunction | JWT | ADMIN, SUPERVISOR |
| POST | `/tickets/{ticketId}/close` | TicketsFunction | JWT | Participant |
| GET | `/admin/dashboard` | AdminFunction | JWT | ADMIN, SUPERVISOR |
| GET | `/admin/users` | AdminFunction | JWT | ADMIN |
| GET | `/admin/audit-logs` | AdminFunction | JWT | ADMIN |
| GET | `/admin/analytics` | AdminFunction | JWT | ADMIN, SUPERVISOR |
| POST | `/admin/database/migrate` | DatabaseMigrationLambda | JWT | ADMIN |
| POST | `/admin/database/rollback` | DatabaseMigrationLambda | JWT | ADMIN |
| GET | `/admin/database/migrations` | DatabaseMigrationLambda | JWT | ADMIN |
| POST | `/files/presigned-url` | FilesFunction | JWT | Any |
| POST | `/files/complete-upload` | FilesFunction | JWT | Any |

---

## 2. Lambda Functions

| Logical Name | CDK Function | Runtime | VPC | Timeout |
|--------------|--------------|---------|-----|---------|
| DatabaseBootstrapLambda | `petvetcare-{env}-db-bootstrap` | nodejs20.x | Yes | 10m |
| DatabaseMigrationLambda | `petvetcare-{env}-db-migration` | nodejs20.x | Yes | 5m |
| SendOtpLambda / VerifyOtpLambda / LogoutLambda / GetCurrentUserLambda | `petvetcare-{env}-auth` | nodejs20.x | Yes | 29s |
| HealthFunction | `petvetcare-{env}-health` | nodejs20.x | Yes | 29s |
| ProfileFunction | `petvetcare-{env}-profile` | nodejs20.x | Yes | 29s |
| PetsFunction | `petvetcare-{env}-pets` | nodejs20.x | Yes | 29s |
| HealthRecordsFunction | `petvetcare-{env}-health-records` | nodejs20.x | Yes | 29s |
| VaccinationsFunction | `petvetcare-{env}-vaccinations` | nodejs20.x | Yes | 29s |
| PrescriptionsFunction | `petvetcare-{env}-prescriptions` | nodejs20.x | Yes | 29s |
| AppointmentsFunction | `petvetcare-{env}-appointments` | nodejs20.x | Yes | 29s |
| DoctorsFunction | `petvetcare-{env}-doctors` | nodejs20.x | Yes | 29s |
| StoresFunction | `petvetcare-{env}-stores` | nodejs20.x | Yes | 29s |
| ProductsFunction | `petvetcare-{env}-products` | nodejs20.x | Yes | 29s |
| OrdersFunction | `petvetcare-{env}-orders` | nodejs20.x | Yes | 29s |
| PaymentsFunction | `petvetcare-{env}-payments` | nodejs20.x | Yes | 29s |
| TicketsFunction | `petvetcare-{env}-tickets` | nodejs20.x | Yes | 29s |
| AdminFunction | `petvetcare-{env}-admin` | nodejs20.x | Yes | 29s |
| FilesFunction | `petvetcare-{env}-files` | nodejs20.x | Yes | 29s |
| RemindersFunction | `petvetcare-{env}-reminders` | nodejs20.x | Yes | 5m |

**Shared libraries:** `lambda/shared/db.ts`, `lambda/shared/api.ts`, `lambda/shared/router.ts`, `lambda/shared/events.ts`

---

## 3. Request Schemas

### POST /auth/send-otp
```json
{ "email": "user@example.com" }
```

### POST /auth/verify-otp
```json
{ "email": "user@example.com", "otp": "123456" }
```

### PUT /profile
```json
{ "first_name": "Jane", "last_name": "Doe", "phone_number": "+919876543210" }
```

### POST /pets
```json
{
  "name": "Buddy",
  "species": "Dog",
  "breed": "Golden Retriever",
  "gender": "Male",
  "dob": "2020-05-15",
  "weight": 28.5,
  "microchip_number": "982000123456789"
}
```

### POST /pets/{petId}/health-records
```json
{
  "record_type": "CHECKUP",
  "title": "Annual wellness exam",
  "description": "All vitals normal",
  "record_date": "2026-05-01",
  "attachments": []
}
```

### POST /pets/{petId}/vaccinations
```json
{
  "vaccine_name": "Rabies",
  "administered_by": "Dr. Smith",
  "administered_date": "2026-01-15",
  "due_date": "2027-01-15",
  "notes": "Booster due next year"
}
```

### POST /appointments
```json
{
  "pet_id": "uuid",
  "doctor_id": "uuid",
  "clinic_id": "uuid",
  "appointment_date": "2026-06-15T10:00:00Z",
  "notes": "Annual checkup"
}
```

### POST /orders
```json
{
  "items": [
    { "product_id": "uuid", "quantity": 2, "price": 499.00 }
  ]
}
```

### POST /payments/initiate
```json
{ "amount": 998.00, "order_id": "uuid" }
```

### POST /files/presigned-url
```json
{
  "fileName": "buddy.jpg",
  "contentType": "image/jpeg",
  "category": "gallery"
}
```

### POST /files/complete-upload
```json
{
  "objectKey": "uploads/sub/gallery/123-buddy.jpg",
  "fileName": "buddy.jpg",
  "contentType": "image/jpeg",
  "fileSize": 204800,
  "category": "gallery"
}
```

---

## 4. Response Schemas

### Success envelope
```json
{
  "data": {},
  "meta": { "requestId": "string", "timestamp": "ISO8601" }
}
```

### Error envelope
```json
{
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | INTERNAL_ERROR"
}
```

### GET /auth/me → 200
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "Jane",
    "last_name": "Doe",
    "profile_image_url": "https://cdn.dev.petvetcare.app/...",
    "group_type": "PET_OWNER",
    "status": "ACTIVE"
  }
}
```

### GET /pets → 200
```json
{ "items": [{ "id": "uuid", "name": "Buddy", "species": "Dog", "status": "ACTIVE" }] }
```

### POST /files/presigned-url → 200
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "objectKey": "uploads/...",
  "expiresInSeconds": 900,
  "publicUrl": "https://cdn.dev.petvetcare.app/uploads/..."
}
```

### GET /admin/database/migrations → 200
```json
{
  "migrations": [
    {
      "migration_id": 1,
      "migration_name": "001_initial_schema.sql",
      "applied_at": "2026-05-30T12:00:00Z",
      "applied_by": "DatabaseBootstrapLambda"
    }
  ]
}
```

---

## 5. Authorization Requirements

| Mechanism | Scope |
|-----------|-------|
| **Cognito JWT** | All protected routes via API Gateway Cognito User Pool authorizer |
| **Public** | `/health`, `/auth/send-otp`, `/auth/verify-otp` |
| **Role claims** | `custom:group_type` or `cognito:groups` — ADMIN, SUPERVISOR, PET_OWNER, VETERINARY_DOCTOR, MEDICINE_STORE |
| **Resource ownership** | Pets, orders scoped to `owner_id`; tickets scoped to raiser unless ADMIN |
| **Doctor delete** | ADMIN only; SUPERVISOR cannot DELETE `/doctors/{doctorId}` |
| **Database admin** | ADMIN only for `/admin/database/*` |

**Token format:** `Authorization: Bearer {id_token}` or `{access_token}`

**JWT issuer:** `https://cognito-idp.{region}.amazonaws.com/{userPoolId}`

---

## 6. Database Schema

Location: `database/migrations/`

| Migration | Purpose |
|-----------|---------|
| `000_schema_migrations.sql` | Migration audit table |
| `001_initial_schema.sql` | Full schema (users, pets, health, commerce, support) |
| `002_seed_data.sql` | User groups, settings, categories, admin user |

**Core tables:** `users`, `user_groups`, `application_settings`, `pets`, `pet_health_records`, `pet_vaccinations`, `veterinary_doctors`, `clinics`, `appointments`, `prescriptions`, `medicine_stores`, `products`, `orders`, `payments`, `support_tickets`, `file_uploads`, `audit_logs`, `schema_migrations`

**ORM:** Raw SQL via `pg` driver — no Prisma.

---

## 7. Database Migration Strategy

### First deploy (automatic)
```
CDK Deploy → Aurora + RDS Proxy → DatabaseBootstrapLambda (Custom Resource)
  → 000_schema_migrations.sql → 001_initial_schema.sql → 002_seed_data.sql
```

### Future changes
1. Add `database/migrations/003_{description}.sql`
2. Add optional `003_{description}.down.sql` for rollback
3. Deploy stack OR call `POST /admin/database/migrate`
4. Migration recorded in `schema_migrations`

### Tracking table
```sql
schema_migrations (migration_id, migration_name, applied_at, applied_by)
```

---

## 8. Postman Test Collection

File: `postman/PetVetCare-API.postman_collection.json`

Folders: Authentication, Profile, Pets, Vaccinations, Prescriptions, Appointments, Doctors, Stores, Products, Orders, Payments, Tickets, Admin, Files, Database

Each endpoint includes: Positive, Negative (400), Validation, Authorization (401/403), Role-based tests.

---

## 9. Integration Test Plan

| Suite | Scope | Tool |
|-------|-------|------|
| Auth flow | OTP send → verify → me → logout | Postman/Newman |
| Pet CRUD | Create → list → get → update → delete | Newman |
| File upload | Presign → S3 PUT → complete-upload | Newman + AWS SDK |
| Appointment booking | Create appointment → EventBridge event | Newman |
| Admin migration | migrate → list → rollback | Newman (admin token) |
| Cross-service | Order → payment initiate → success | Newman |

**Environment variables:** `baseUrl`, `accessToken`, `adminToken`, `petId`, `orderId`

**CI gate:** Newman run on PR against `dev` stage; block merge on failure.

---

## 10. Security Testing Plan

| Test | Method |
|------|--------|
| JWT tampering | Modify payload, expect 401 |
| Expired token | Use expired JWT, expect 401 |
| Role escalation | PET_OWNER calls DELETE /doctors, expect 403 |
| IDOR | Access another user's pet by UUID, expect 404 |
| SQL injection | `' OR 1=1 --` in query params, expect safe handling |
| Presigned URL scope | Upload to wrong key prefix, expect S3 deny |
| CORS | Request from unauthorized origin |
| Rate limiting | OTP flood on /auth/send-otp (WAF recommended) |
| Secrets exposure | Scan Lambda env for plaintext credentials |
| SSL/TLS | CloudFront HTTPS-only, Aurora force_ssl |

---

## 11. Performance Testing Plan

| Scenario | Target | Tool |
|----------|--------|------|
| Health check | p99 < 100ms | k6 |
| GET /pets (10 items) | p99 < 500ms | k6 |
| POST /orders | p99 < 1s | k6 |
| Concurrent users | 100 VUs, 5 min | k6 |
| RDS Proxy connection pool | No connection exhaustion | CloudWatch `DatabaseConnections` |
| Aurora scaling | ACU scales 0.5→4 under load | CloudWatch `ServerlessDatabaseCapacity` |
| CloudFront cache hit | > 80% for static assets | CloudWatch |

**Load profile:** Ramp 0→100 VUs over 2 min, sustain 5 min, ramp down 1 min.

---

## 12. AWS CDK Infrastructure

| Stack | Region | Resources |
|-------|--------|-----------|
| `petvetcare-{env}-network` | Primary | VPC, subnets, NAT, SGs, endpoints |
| `petvetcare-{env}-auth` | Primary | Cognito User Pool, clients, IdPs |
| `petvetcare-{env}-dns` | Primary | Imported Route 53 zone (no creation) |
| `petvetcare-{env}-public-assets` | **us-east-1** | S3, CloudFront OAC, existing ACM cert |
| `petvetcare-{env}-database` | Primary | Aurora Serverless v2, RDS Proxy, Bootstrap CR |
| `petvetcare-{env}-api` | Primary | REST API Gateway, Lambdas, EventBridge |

### Certificate fix (CloudFront)
- **Do not** create ACM certificates in CDK
- Set `ACM_CERTIFICATE_ARN` to existing us-east-1 cert: `arn:aws:acm:us-east-1:919620897356:certificate/31b54113-4e06-4f73-9c7d-136c1918e63e`
- Ensure cert covers `cdn.dev.petvetcare.app` (or your `PUBLIC_ASSET_CDN_DOMAIN`)
- `PublicAssetsStack` deploys in us-east-1 with `Certificate.fromCertificateArn()`

### DNS (no new hosted zone)
- Set `HOSTED_ZONE_ID` to existing zone
- Set `CREATE_DNS_RECORDS=false` if DNS is managed externally
- Manually create CNAME: `cdn.dev.petvetcare.app` → CloudFront distribution domain

---

## 13. CI/CD Deployment Strategy

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│ Git Push    │───▶│ GitHub Actions│───▶│ cdk synth       │───▶│ cdk deploy   │
│ main/develop│    │ npm ci/build  │    │ security scan   │    │ --all        │
└─────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘
                                              │
                                              ▼
                                       Newman integration tests
```

### Environments
| Branch | Environment | Approval |
|--------|-------------|----------|
| `develop` | dev | Auto |
| `staging` | staging | Manual |
| `main` | prod | Manual + 2 reviewers |

### Pipeline steps
1. `npm ci && npm run build`
2. `cdk synth` (validate templates)
3. `cdk deploy petvetcare-dev-* --require-approval never` (dev only)
4. Newman Postman collection against deployed API
5. Amplify webhook triggers Next.js frontend deploy (separate repo)

### Secrets (GitHub Actions)
- `AWS_ROLE_ARN` (OIDC)
- `HOSTED_ZONE_ID`, `ACM_CERTIFICATE_ARN`
- `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`

---

## 14. EventBridge Events

| Event | Source | Consumers |
|-------|--------|-----------|
| UserRegistered | petvetcare.api | Welcome email Lambda |
| PetCreated | petvetcare.api | Analytics Lambda |
| VaccinationCreated | petvetcare.api | ReminderScheduler Lambda |
| AppointmentBooked | petvetcare.api | CalendarSync Lambda, SNS notify |
| StoreApproved | petvetcare.api | StoreOwnerNotify Lambda |
| OrderCreated | petvetcare.api | Inventory Lambda |
| TicketCreated | petvetcare.api | SupportQueue Lambda |
| TicketResolved | petvetcare.api | CSAT survey Lambda |

Publisher: `lambda/shared/events.ts` → `publishEvent()`

---

## Deployment Checklist

1. Copy `.env.example` → `.env` and set:
   - `HOSTED_ZONE_ID`
   - `ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:919620897356:certificate/31b54113-4e06-4f73-9c7d-136c1918e63e`
   - `PUBLIC_ASSET_CDN_DOMAIN=cdn.dev.petvetcare.app`
   - `CREATE_DNS_RECORDS=false`
2. Bootstrap both regions: `cdk bootstrap aws://ACCOUNT/us-east-1` and primary region
3. Verify ACM cert includes CDN domain and is **Issued** in us-east-1
4. Manually point `cdn.dev.petvetcare.app` CNAME to CloudFront if not using CDK DNS
5. `npm run deploy`
6. Verify bootstrap: `GET /admin/database/migrations` (admin token)
7. Import Postman collection and run Authentication folder
