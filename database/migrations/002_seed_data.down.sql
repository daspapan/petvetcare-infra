-- Rollback 002_seed_data.sql
DELETE FROM users WHERE email = 'admin@petvetcare.app';
DELETE FROM product_categories WHERE name IN (
  'Food & Nutrition', 'Medications', 'Grooming', 'Accessories', 'Health & Wellness'
);
DELETE FROM application_settings WHERE setting_key LIKE 'platform.%'
  OR setting_key LIKE 'auth.%' OR setting_key LIKE 'payments.%'
  OR setting_key LIKE 'notifications.%' OR setting_key LIKE 'store.%'
  OR setting_key LIKE 'subscription.%';
DELETE FROM user_groups WHERE group_name IN (
  'ADMIN', 'SUPERVISOR', 'PET_OWNER', 'VETERINARY_DOCTOR', 'MEDICINE_STORE'
);
