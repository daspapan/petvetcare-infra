-- Seed data: user groups, application settings, admin user placeholder

INSERT INTO user_groups (group_name, description) VALUES
  ('ADMIN', 'Platform administrators with full access'),
  ('SUPERVISOR', 'Supervisors with elevated access, cannot delete doctors'),
  ('PET_OWNER', 'Pet owners managing their pets'),
  ('VETERINARY_DOCTOR', 'Licensed veterinary doctors'),
  ('MEDICINE_STORE', 'Verified medicine store operators')
ON CONFLICT (group_name) DO NOTHING;

INSERT INTO application_settings (setting_key, setting_value, description) VALUES
  ('platform.name', '"PetVetCare"', 'Platform display name'),
  ('platform.domain', '"petvetcare.app"', 'Primary domain'),
  ('auth.otp_expiry_seconds', '300', 'OTP validity in seconds'),
  ('auth.otp_max_attempts', '5', 'Maximum OTP verification attempts'),
  ('payments.default_provider', '"DUMMY"', 'Default payment provider'),
  ('notifications.vaccination_reminder_days', '7', 'Days before vaccination due to send reminder'),
  ('store.auto_approve', 'false', 'Auto-approve store registrations'),
  ('subscription.free_pet_limit', '2', 'Maximum pets for free tier')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO product_categories (name, description) VALUES
  ('Food & Nutrition', 'Pet food and dietary supplements'),
  ('Medications', 'Prescription and OTC medications'),
  ('Grooming', 'Grooming supplies and tools'),
  ('Accessories', 'Collars, leashes, beds, and toys'),
  ('Health & Wellness', 'Vitamins, supplements, and health products')
ON CONFLICT (name) DO NOTHING;

-- Admin user seeded with placeholder cognito_sub; updated on first admin login
INSERT INTO users (
  id, cognito_sub, email, first_name, last_name, group_type, status
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'seed-admin',
  'admin@petvetcare.app',
  'System',
  'Administrator',
  'ADMIN',
  'ACTIVE'
) ON CONFLICT (email) DO NOTHING;
